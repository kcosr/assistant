import { describe, expect, it } from 'vitest';

import { resolveCliRuntimeConfig } from './cliRuntimeConfig';

describe('resolveCliRuntimeConfig', () => {
  it('resolves session working dir macros in workdir and wrapper env', () => {
    const resolved = resolveCliRuntimeConfig(
      {
        workdir: '${session.workingDir}',
        extraArgs: ['--skip-git-repo-check'],
        wrapper: {
          path: '/tmp/run.sh',
          env: {
            CONTAINER_CWD: '${session.workingDir}',
            STATIC_VALUE: '1',
          },
        },
      },
      {
        sessionId: 'session-1',
        workingDir: '/home/kevin/worktrees/app',
      },
    );

    expect(resolved).toEqual({
      workdir: '/home/kevin/worktrees/app',
      extraArgs: ['--skip-git-repo-check'],
      wrapper: {
        path: '/tmp/run.sh',
        env: {
          CONTAINER_CWD: '/home/kevin/worktrees/app',
          STATIC_VALUE: '1',
        },
      },
    });
  });

  it('drops empty workdir when the session working dir is unavailable', () => {
    const resolved = resolveCliRuntimeConfig(
      {
        workdir: '${session.workingDir}',
        wrapper: {
          path: '/tmp/run.sh',
          env: {
            CONTAINER_CWD: '${session.workingDir}',
          },
        },
      },
      {
        sessionId: 'session-1',
      },
    );

    expect(resolved).toEqual({
      wrapper: {
        path: '/tmp/run.sh',
        env: {
          CONTAINER_CWD: '',
        },
      },
    });
  });
});
