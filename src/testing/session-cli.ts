#!/usr/bin/env ts-node

import { SessionClient, EventEnvelope } from './websocket-api';

type CommandName =
  | 'list'
  | 'subscribe'
  | 'exec'
  | 'tail'
  | 'create'
  | 'kill'
  | 'input'
  | 'signal'
  | 'help';

interface ParsedArgs {
  command: CommandName;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

const DEFAULT_URL = process.env.SESSION_API_URL || 'ws://localhost:3100';

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...rest] = argv;
  const command = (commandRaw || 'help') as CommandName;
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  let pendingFlag: string | null = null;

  for (const token of rest) {
    if (pendingFlag) {
      flags[pendingFlag] = token;
      pendingFlag = null;
      continue;
    }

    if (token.startsWith('--')) {
      const [key, value] = token.slice(2).split('=');
      if (value === undefined || value.length === 0) {
        pendingFlag = key;
      } else {
        flags[key] = value;
      }
      continue;
    }

    if (token.startsWith('-')) {
      const key = token.slice(1);
      pendingFlag = key;
      continue;
    }

    positionals.push(token);
  }

  if (pendingFlag) {
    flags[pendingFlag] = true;
  }

  return { command, positionals, flags };
}

function printUsage(): void {
  const text = `Usage: session-cli <command> [options]

Commands:
  list                         List active sessions
  subscribe <id|all> [options] Stream live session events (Ctrl+C to exit)
      --replay=<lines>         Replay the last N log lines when subscribing
      --json                   Emit JSON envelopes instead of formatted text
  exec <session> <command...>  Run a command inside a session
  tail <session> [--lines=N]   Print recent session output (default 50)
  create <session> [--cwd=DIR] Create a new session
  kill <session>               Terminate a session
  input <session> <text...>    Send input to a session
  signal <session> [--signal=SIGINT] Send a signal to a session

Options:
  --url=<ws://host:port>       Session API URL (default ${DEFAULT_URL})
  --help                       Show this help message
`;
  console.log(text);
}

function resolveUrl(flags: Record<string, string | boolean>): string {
  const url = flags.url || flags.URL || flags.u;
  return typeof url === 'string' && url.length > 0 ? url : DEFAULT_URL;
}

async function handleList(client: SessionClient) {
  const sessions = await client.listSessions();
  if (!sessions.length) {
    console.log('No active sessions');
    return;
  }
  for (const session of sessions) {
    const namePart = session.name ? ` (${session.name})` : '';
    console.log(
      `${session.id}${namePart} pid=${session.pid ?? 'n/a'} alive=${session.isAlive}`
    );
  }
}

async function handleExec(client: SessionClient, positionals: string[]) {
  const [sessionId, ...rest] = positionals;
  if (!sessionId || rest.length === 0) {
    throw new Error('Usage: exec <session> <command...>');
  }
  const command = rest.join(' ');
  const result = await client.exec(sessionId, command);
  console.log(result.output);
  console.log(`exitCode=${result.exitCode} duration=${result.duration}ms`);
}

async function handleTail(
  client: SessionClient,
  positionals: string[],
  flags: Record<string, string | boolean>
) {
  const [sessionId] = positionals;
  if (!sessionId) {
    throw new Error('Usage: tail <session> [--lines=N]');
  }
  const linesFlag = flags.lines ?? flags.n;
  const lineCount = typeof linesFlag === 'string' ? parseInt(linesFlag, 10) : undefined;
  const output = await client.getOutput(sessionId, lineCount || 50);
  if (!output.length) {
    console.log('No output recorded yet');
    return;
  }
  output.forEach((line: string) => console.log(line));
}

async function handleCreate(
  client: SessionClient,
  positionals: string[],
  flags: Record<string, string | boolean>
) {
  const [sessionId] = positionals;
  if (!sessionId) {
    throw new Error('Usage: create <session> [--cwd=DIR]');
  }
  const cwd = typeof flags.cwd === 'string' ? flags.cwd : undefined;
  const envFlag = flags.env;
  let env: Record<string, string> | undefined;
  if (typeof envFlag === 'string') {
    env = {};
    for (const pair of envFlag.split(',')) {
      const [key, value = ''] = pair.split('=');
      if (key) {
        env[key] = value;
      }
    }
  }
  await client.createSession({ id: sessionId, cwd, env });
  console.log(`Session ${sessionId} created`);
}

async function handleKill(client: SessionClient, positionals: string[]) {
  const [sessionId] = positionals;
  if (!sessionId) {
    throw new Error('Usage: kill <session>');
  }
  await client.request('session.kill', { sessionId });
  console.log(`Session ${sessionId} terminated`);
}

async function handleInput(
  client: SessionClient,
  positionals: string[],
  flags: Record<string, string | boolean>
) {
  const [sessionId, ...rest] = positionals;
  if (!sessionId || rest.length === 0) {
    throw new Error('Usage: input <session> <text...>');
  }
  const text = rest.join(' ');
  const append = flags.raw ? false : true;
  await client.sendInput(sessionId, text, append);
  console.log('Input sent');
}

async function handleSignal(
  client: SessionClient,
  positionals: string[],
  flags: Record<string, string | boolean>
) {
  const [sessionId] = positionals;
  if (!sessionId) {
    throw new Error('Usage: signal <session> [--signal=SIG]');
  }
  const signal = typeof flags.signal === 'string' ? flags.signal : 'SIGINT';
  await client.sendSignal(sessionId, signal);
  console.log(`Signal ${signal} sent`);
}

async function handleSubscribe(
  client: SessionClient,
  positionals: string[],
  flags: Record<string, string | boolean>
) {
  const [target] = positionals;
  if (!target) {
    throw new Error('Usage: subscribe <session|all> [--replay=N] [--json]');
  }

  const replayFlag = flags.replay ?? flags.r;
  const replay = typeof replayFlag === 'string' ? parseInt(replayFlag, 10) : undefined;
  const useJson = Boolean(flags.json);
  const all = target === 'all' || Boolean(flags.all);

  await client.subscribe({
    all,
    sessionId: all ? undefined : target,
    replay,
  });

  const render = (envelope: EventEnvelope) => {
    if (!all && envelope.sessionId && envelope.sessionId !== target) {
      return;
    }
    if (useJson) {
      console.log(JSON.stringify(envelope));
      return;
    }
    const timestamp = new Date().toISOString();
    const sessionLabel = envelope.sessionId ? ` ${envelope.sessionId}` : '';
    console.log(`[${timestamp}] ${envelope.event}${sessionLabel}`);
    if (envelope.payload) {
      console.log(JSON.stringify(envelope.payload, null, 2));
    }
  };

  const handler = (envelope: EventEnvelope) => render(envelope);
  client.on('event', handler);

  console.log('Streaming events. Press Ctrl+C to exit.');

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      client.off('event', handler);
      resolve();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2));

  if (command === 'help' || flags.help) {
    printUsage();
    return;
  }

  const url = resolveUrl(flags);
  const client = new SessionClient(url);

  try {
    switch (command) {
      case 'list':
        await handleList(client);
        break;
      case 'exec':
        await handleExec(client, positionals);
        break;
      case 'tail':
        await handleTail(client, positionals, flags);
        break;
      case 'create':
        await handleCreate(client, positionals, flags);
        break;
      case 'kill':
        await handleKill(client, positionals);
        break;
      case 'input':
        await handleInput(client, positionals, flags);
        break;
      case 'signal':
        await handleSignal(client, positionals, flags);
        break;
      case 'subscribe':
        await handleSubscribe(client, positionals, flags);
        break;
      default:
        printUsage();
        break;
    }
  } catch (error: any) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    if (command !== 'subscribe') {
      client.close();
    }
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
