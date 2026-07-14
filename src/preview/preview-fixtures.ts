export const PREVIEW_SESSIONS = [
  {
    id: 'ses_01JZ8K5A',
    title: 'iOS native migration plan',
    model: 'anthropic/claude-sonnet-4',
    messages: 34,
    tools: 18,
    updated: '2 min ago',
    active: true,
    preview: 'Mapped the customized WebUI route ownership and native interaction contracts.',
  },
  {
    id: 'ses_01JZ6R2Q',
    title: 'Gateway deployment audit',
    model: 'openrouter/qwen3-235b',
    messages: 21,
    tools: 9,
    updated: '48 min ago',
    active: false,
    preview: 'Deployment is healthy. The gateway is listening on the configured interface.',
  },
  {
    id: 'ses_01JYYT90',
    title: 'Hermes plugin compatibility',
    model: 'nous/hermes-4-405b',
    messages: 57,
    tools: 31,
    updated: 'Yesterday',
    active: false,
    preview: 'Validated achievements, kanban, and collaboration manifest placement.',
  },
  {
    id: 'ses_01JYW52P',
    title: 'Research digest automation',
    model: 'anthropic/claude-sonnet-4',
    messages: 16,
    tools: 6,
    updated: 'Jul 11',
    active: false,
    preview: 'Created a weekday schedule and configured Telegram delivery.',
  },
] as const;

export const PREVIEW_MESSAGES = [
  {
    role: 'user',
    content: 'Keep the customized WebUI as the source of truth, but make the iOS client fully native.',
    time: '14:02',
  },
  {
    role: 'assistant',
    content: 'I will preserve the route map, visual tokens, fonts, controls, motion curves, and plugin ordering. Backend calls stay outside this frontend preview.',
    time: '14:02',
  },
  {
    role: 'tool',
    content: 'read_file: web/src/App.tsx\nread_file: web/src/themes/context.tsx\nstatus: complete',
    time: '14:03',
  },
  {
    role: 'assistant',
    content: 'The adaptive shell now matches the WebUI information architecture on iPhone and iPad. The next layer is the native page surface.',
    time: '14:04',
  },
] as const;

export const PREVIEW_FILES = [
  { name: 'config.yaml', kind: 'file', size: '8.4 KB', modified: 'Today 13:48' },
  { name: 'profiles', kind: 'folder', size: '--', modified: 'Today 12:31' },
  { name: 'skills', kind: 'folder', size: '--', modified: 'Yesterday' },
  { name: 'sessions', kind: 'folder', size: '--', modified: 'Today 14:04' },
  { name: '.env', kind: 'file', size: '1.2 KB', modified: 'Jul 12' },
  { name: 'hermes.log', kind: 'file', size: '2.7 MB', modified: 'Today 14:05' },
] as const;

export const PREVIEW_TOKEN_DAYS = [
  { label: 'Jul 8', value: 184 },
  { label: 'Jul 9', value: 312 },
  { label: 'Jul 10', value: 246 },
  { label: 'Jul 11', value: 508 },
  { label: 'Jul 12', value: 436 },
  { label: 'Jul 13', value: 672 },
  { label: 'Jul 14', value: 529 },
] as const;

export const PREVIEW_MODELS = [
  {
    provider: 'Anthropic',
    model: 'claude-sonnet-4',
    input: '1.84M',
    output: '228K',
    calls: 184,
    context: '200K',
    selected: true,
  },
  {
    provider: 'OpenRouter',
    model: 'qwen3-235b-a22b',
    input: '894K',
    output: '116K',
    calls: 92,
    context: '131K',
    selected: false,
  },
  {
    provider: 'Nous',
    model: 'hermes-4-405b',
    input: '422K',
    output: '71K',
    calls: 38,
    context: '128K',
    selected: false,
  },
] as const;

export const PREVIEW_LOGS = [
  ['14:05:12.442', 'INFO', 'gateway', 'WebSocket client connected profile=default'],
  ['14:05:10.198', 'DEBUG', 'scheduler', 'next tick in 30s jobs=3'],
  ['14:04:58.031', 'INFO', 'agent', 'session resumed id=ses_01JZ8K5A'],
  ['14:04:42.720', 'INFO', 'plugins', 'loaded dashboard manifests count=3'],
  ['14:04:33.016', 'WARN', 'memory', 'compaction threshold at 82%'],
  ['14:04:21.894', 'DEBUG', 'tools', 'read_file completed duration_ms=18'],
  ['14:04:01.253', 'INFO', 'gateway', 'heartbeat healthy latency_ms=24'],
] as const;

export const PREVIEW_CRON = [
  {
    id: 'daily-research',
    name: 'Daily research digest',
    schedule: 'Weekdays at 09:00',
    next: 'Tomorrow 09:00',
    delivery: 'Telegram',
    enabled: true,
  },
  {
    id: 'repo-health',
    name: 'Repository health check',
    schedule: 'Every 6 hours',
    next: 'Today 18:00',
    delivery: 'Local',
    enabled: true,
  },
  {
    id: 'weekly-backup',
    name: 'Weekly configuration backup',
    schedule: 'Sunday at 02:30',
    next: 'Sun 02:30',
    delivery: 'Local',
    enabled: false,
  },
] as const;

export const PREVIEW_SKILLS = [
  { name: 'github-code-review', category: 'Development', description: 'Review pull requests with repository context.', enabled: true },
  { name: 'frontend-design', category: 'Development', description: 'Build polished user-facing interfaces.', enabled: true },
  { name: 'deep-research', category: 'Research', description: 'Run multi-source research and produce cited reports.', enabled: true },
  { name: 'pdf', category: 'Documents', description: 'Read, create, and inspect PDF documents.', enabled: true },
  { name: 'ppt-master', category: 'Documents', description: 'Create and revise presentation decks.', enabled: false },
  { name: 'browser-use', category: 'Automation', description: 'Operate browser workflows through a controlled agent.', enabled: true },
] as const;

export const PREVIEW_TOOLSETS = [
  { name: 'Browser', detail: 'Playwright browser automation', active: true, setup: false },
  { name: 'GitHub', detail: 'Repositories, issues, and pull requests', active: true, setup: false },
  { name: 'Google Workspace', detail: 'Drive, Gmail, Docs, and Calendar', active: false, setup: true },
] as const;

export const PREVIEW_PLUGINS = [
  { name: 'collaboration', label: 'Group Chat & Workflow', version: '2.1.36', source: 'bundled', active: true, tab: 'Hidden slot' },
  { name: 'hermes-achievements', label: 'Achievements', version: '0.4.0', source: 'bundled', active: true, tab: '/achievements' },
  { name: 'kanban', label: 'Kanban', version: '1.0.1', source: 'bundled', active: true, tab: '/kanban' },
] as const;

export const PREVIEW_MCP = [
  { name: 'filesystem', transport: 'stdio', endpoint: 'npx @modelcontextprotocol/server-filesystem', tools: 12, active: true },
  { name: 'github', transport: 'http', endpoint: 'https://mcp.github.example/v1', tools: 27, active: true },
  { name: 'linear', transport: 'http', endpoint: 'https://mcp.linear.example/v1', tools: 0, active: false },
] as const;

export const PREVIEW_PAIRINGS = [
  { name: 'Given iPhone 16 Pro', platform: 'iOS', lastSeen: 'Now', status: 'Connected' },
  { name: 'MacBook Pro', platform: 'macOS', lastSeen: '12 min ago', status: 'Authorized' },
  { name: 'iPad Pro', platform: 'iPadOS', lastSeen: 'Yesterday', status: 'Authorized' },
] as const;

export const PREVIEW_CHANNELS = [
  { name: 'Telegram', account: '@hermes_given_bot', status: 'Connected', users: '2 allowed users' },
  { name: 'Discord', account: 'Hermes Agent#2048', status: 'Connected', users: '3 guilds' },
  { name: 'WhatsApp', account: '+86 138 **** 3311', status: 'Disabled', users: 'Not configured' },
  { name: 'Slack', account: 'Hermes Workspace', status: 'Disabled', users: 'Not configured' },
] as const;

export const PREVIEW_WEBHOOKS = [
  { name: 'github-push', description: 'Review pushes to the native iOS branch.', events: 'push, pull_request', deliveries: 18, active: true },
  { name: 'build-complete', description: 'Summarize finished EAS builds.', events: 'build.finished', deliveries: 7, active: true },
] as const;

export const PREVIEW_PROFILES = [
  { name: 'default', description: 'General Hermes assistant', model: 'claude-sonnet-4', skills: 18, active: true, env: true },
  { name: 'ios-native', description: 'React Native and iOS implementation agent', model: 'claude-sonnet-4', skills: 12, active: false, env: true },
  { name: 'researcher', description: 'Long-form research and synthesis', model: 'qwen3-235b-a22b', skills: 9, active: false, env: false },
] as const;

export const PREVIEW_ENV_GROUPS = [
  {
    name: 'LLM Providers',
    entries: [
      ['ANTHROPIC_API_KEY', true, 'sk-ant-...9wK2'],
      ['OPENROUTER_API_KEY', true, 'sk-or-...7Lm4'],
      ['OPENAI_API_KEY', false, ''],
      ['NOUS_API_KEY', true, 'nous-...3Jd8'],
    ],
  },
  {
    name: 'Messaging',
    entries: [
      ['TELEGRAM_BOT_TOKEN', true, '8312...AAHk'],
      ['DISCORD_BOT_TOKEN', true, 'MTIz...gV9a'],
      ['SLACK_BOT_TOKEN', false, ''],
    ],
  },
  {
    name: 'Search & Tools',
    entries: [
      ['FIRECRAWL_API_KEY', true, 'fc-...pQ12'],
      ['SERPER_API_KEY', false, ''],
      ['GITHUB_TOKEN', true, 'ghp_...6Zx1'],
    ],
  },
] as const;

export const PREVIEW_CONFIG_SECTIONS = [
  {
    name: 'General',
    fields: [
      ['default_model', 'anthropic/claude-sonnet-4'],
      ['max_iterations', '50'],
      ['timezone', 'Asia/Shanghai'],
    ],
  },
  {
    name: 'Terminal',
    fields: [
      ['shell', '/bin/zsh'],
      ['terminal_font_size', '13'],
      ['stream_output', 'true'],
    ],
  },
  {
    name: 'Memory',
    fields: [
      ['provider', 'builtin'],
      ['context_engine', 'hermes'],
      ['auto_compact_threshold', '0.82'],
    ],
  },
] as const;

export const PREVIEW_KANBAN = [
  {
    name: 'Triage',
    cards: [
      { id: 'HMS-142', title: 'Verify iPad split navigation', profile: 'ios-native', priority: 'P1' },
      { id: 'HMS-145', title: 'Audit notification deep links', profile: 'default', priority: 'P2' },
    ],
  },
  {
    name: 'Ready',
    cards: [
      { id: 'HMS-138', title: 'Native attachment preview', profile: 'ios-native', priority: 'P1' },
    ],
  },
  {
    name: 'Running',
    cards: [
      { id: 'HMS-131', title: 'Complete frontend fixture routes', profile: 'ios-native', priority: 'P0' },
    ],
  },
  {
    name: 'Done',
    cards: [
      { id: 'HMS-126', title: 'Bundle canonical font catalog', profile: 'ios-native', priority: 'P0' },
      { id: 'HMS-129', title: 'Implement exact live blur module', profile: 'ios-native', priority: 'P0' },
    ],
  },
] as const;

export const PREVIEW_ACHIEVEMENTS = [
  { name: 'Toolsmith', detail: 'Use 100 tool calls across Hermes sessions.', tier: 'Gold', progress: 100, unlocked: true },
  { name: 'Deep Context', detail: 'Complete a session with more than 100K input tokens.', tier: 'Silver', progress: 100, unlocked: true },
  { name: 'Night Shift', detail: 'Finish ten tasks between midnight and 05:00.', tier: 'Copper', progress: 70, unlocked: false },
  { name: 'Native Instinct', detail: 'Ship a workflow without a browser surface.', tier: 'Diamond', progress: 42, unlocked: false },
] as const;
