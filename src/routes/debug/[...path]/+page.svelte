<script lang="ts">
	// Mounts the entire debug UI from the library. The catch-all rest param picks
	// the page; nacelle-core's DebugApp renders nav + chat/plot/logs. This one file
	// is all a consumer app needs for /debug.
	import { page } from '$app/state';
	import { DebugApp } from 'nacelle-core/components';
</script>

<DebugApp path={page.params.path ?? ''} />
