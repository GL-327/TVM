// Core runs under Node's type stripping, so no parameter properties, enums or namespaces.
export class HubError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message = code.replaceAll('_', ' ')) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.code = code;
  }
}
export class HubUnavailableError extends HubError {
  constructor(cause?: unknown) {
    super(503, 'hub_unavailable', 'The Hub store is unavailable.');
    this.name = 'HubUnavailableError';
    this.cause = cause;
  }
}
export function bad(code = 'invalid_request'): never { throw new HubError(400, code); }
export function notFound(): never { throw new HubError(404, 'not_found'); }
