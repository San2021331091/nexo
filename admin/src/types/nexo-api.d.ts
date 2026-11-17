declare module '@nexo/api' {
  /** Base URL (ending in /api/v1) of the NestJS API running in this process on a loopback port. */
  export function localBaseUrl(): Promise<string>;
}
