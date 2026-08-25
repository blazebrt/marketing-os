declare module 'undici' {
  export class Agent {
    constructor(opts?: Record<string, unknown>);
  }
  export function fetch(url: string, init?: Record<string, unknown>): Promise<Response>;
}
