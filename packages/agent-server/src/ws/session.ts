import type { MultiplexedConnectionOptions } from './multiplexedConnection';
import { MultiplexedConnection } from './multiplexedConnection';

/**
 * Backwards-compatible alias for MultiplexedConnection.
 *
 * Tests and existing callers construct Session instances directly;
 * Session now extends MultiplexedConnection so they transparently
 * benefit from multiplexing support.
 */
export class Session extends MultiplexedConnection {
  constructor(options: MultiplexedConnectionOptions) {
    super(options);
  }
}
