// Mounts the entire nacelle API from the library. Every /api/* endpoint is
// dispatched by nacelle-core's internal router — this one file is all that's
// needed downstream.
export { GET, POST, PUT, DELETE } from 'nacelle-core/api';
