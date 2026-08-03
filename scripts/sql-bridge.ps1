<#
  bridge.ps1 — persistent SQL Server worker.

  One process == one live SqlConnection using Windows Integrated auth (the only
  passwordless auth path that works on this box — native Node drivers hang or
  can't do it on Node 24). The Node side spawns one bridge per query sheet, so
  session state (temp tables, SET options) survives between runs like an SSMS tab.

  Protocol: JSON lines. stdin request -> stdout response, correlated by `id`.
    {"id":1,"op":"connect","server":"...","database":"..."}
    {"id":2,"op":"query","sqlB64":"...","maxRows":10000,"timeout":120}
    {"id":3,"op":"ping"}
  Response: {"id":N,"ok":true,...} | {"id":N,"ok":false,"error":"..."}
  Query responses carry resultSets[{columns[{name,type}],rows[[..]],rowCount,truncated}],
  messages[], rowsAffected, elapsedMs. Rows are arrays (not objects) so duplicate
  and empty column names — common in ad-hoc SQL — survive the trip.

  Serialization uses System.Text.Json (ConvertTo-Json is far too slow for wide
  10k-row result sets).
#>

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

$script:conn = $null
$script:messages = [System.Collections.Generic.List[object]]::new()

function Send-Response($obj) {
    # Non-generic overload with explicit args — PowerShell can't resolve the
    # generic Serialize<T>(value) form or fill in optional parameters.
    $json = [System.Text.Json.JsonSerializer]::Serialize([object]$obj, [type][object], [System.Text.Json.JsonSerializerOptions]$null)
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

function Open-Connection([string]$server, [string]$database) {
    if ($script:conn) {
        try { $script:conn.Dispose() } catch {}
        $script:conn = $null
    }
    $cs = "Server=$server;Database=$database;Integrated Security=True;TrustServerCertificate=True;Connect Timeout=15;Application Name=dbtool"
    $c = [System.Data.SqlClient.SqlConnection]::new($cs)
    # Capture PRINT output and low-severity errors as messages.
    $c.add_InfoMessage({
        param($s, $e)
        foreach ($err in $e.Errors) {
            $script:messages.Add(@{ text = $err.Message; severity = $err.Class; line = $err.LineNumber })
        }
    })
    $c.FireInfoMessageEventOnUserErrors = $false
    $c.Open()
    $script:conn = $c
}

function Invoke-Query([string]$sql, [int]$maxRows, [int]$timeout) {
    $script:messages.Clear()
    $sw = [System.Diagnostics.Stopwatch]::StartNew()

    $cmd = $script:conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = $timeout
    $reader = $cmd.ExecuteReader()

    $resultSets = [System.Collections.Generic.List[object]]::new()
    try {
        do {
            if ($reader.FieldCount -le 0) { continue }
            $columns = [System.Collections.Generic.List[object]]::new()
            for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                $columns.Add(@{ name = $reader.GetName($i); type = $reader.GetDataTypeName($i) })
            }
            $rows = [System.Collections.Generic.List[object]]::new()
            $truncated = $false
            $count = 0
            while ($reader.Read()) {
                $count++
                if ($rows.Count -ge $maxRows) { $truncated = $true; continue }
                $row = [object[]]::new($reader.FieldCount)
                for ($i = 0; $i -lt $reader.FieldCount; $i++) {
                    $v = $reader.GetValue($i)
                    if ($v -is [System.DBNull]) { $v = $null }
                    $row[$i] = $v
                }
                $rows.Add($row)
            }
            $resultSets.Add(@{ columns = $columns; rows = $rows; rowCount = $count; truncated = $truncated })
        } while ($reader.NextResult())
    }
    finally {
        $reader.Dispose()
        $cmd.Dispose()
    }
    $sw.Stop()

    @{
        ok           = $true
        resultSets   = $resultSets
        messages     = $script:messages.ToArray()
        rowsAffected = $reader.RecordsAffected
        elapsedMs    = [int]$sw.ElapsedMilliseconds
    }
}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }           # stdin closed -> Node killed us or exited
    if ([string]::IsNullOrWhiteSpace($line)) { continue }

    $req = $null
    try { $req = $line | ConvertFrom-Json } catch {
        # Never swallow a request silently — the Node side would hang on it.
        Send-Response @{ id = -1; ok = $false; error = "Bad request JSON: $($_.Exception.Message)" }
        continue
    }
    $id = $req.id

    try {
        switch ($req.op) {
            'connect' {
                Open-Connection $req.server $req.database
                Send-Response @{ id = $id; ok = $true; version = $script:conn.ServerVersion }
            }
            'query' {
                if (-not $script:conn) { throw 'Not connected' }
                if ($script:conn.State -ne [System.Data.ConnectionState]::Open) {
                    # Connection dropped (network blip, idle kill) — reconnect in place.
                    $script:conn.Close()
                    $script:conn.Open()
                }
                $sql = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($req.sqlB64))
                $maxRows = if ($req.maxRows) { [int]$req.maxRows } else { 10000 }
                $timeout = if ($req.timeout) { [int]$req.timeout } else { 300 }
                $result = Invoke-Query $sql $maxRows $timeout
                $result.id = $id
                Send-Response $result
            }
            'ping' {
                Send-Response @{ id = $id; ok = $true }
            }
            default {
                Send-Response @{ id = $id; ok = $false; error = "Unknown op: $($req.op)" }
            }
        }
    }
    catch {
        $ex = $_.Exception
        while ($ex.InnerException -and $ex -isnot [System.Data.SqlClient.SqlException]) { $ex = $ex.InnerException }
        $errInfo = @{ id = $id; ok = $false; error = $ex.Message; messages = $script:messages.ToArray() }
        if ($ex -is [System.Data.SqlClient.SqlException]) {
            $errInfo.line = $ex.LineNumber
            $errInfo.number = $ex.Number
        }
        Send-Response $errInfo
    }
}
