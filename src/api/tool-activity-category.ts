/** Presentation taxonomy only; tool execution remains owned by the backend. */
export function toolActivityCategory(name: string): string {
  const tool = name.toLowerCase().replace(/[.\s-]+/g, '_');
  if (/web_search|search_web|^search$/.test(tool)) return 'search';
  if (/web_extract|web_read|web_fetch|browser|browse|fetch_url/.test(tool)) return 'browser';
  if (/apply_patch|patch_file|file_patch|edit_file|file_edit|write_file|file_write/.test(tool)) return 'edit';
  if (/cron|schedule|workflow/.test(tool)) return 'schedule';
  if (/delegate|subagent|spawn_agent|send_message_to_agent|wait_agent/.test(tool)) return 'subagent';
  if (/terminal|shell|exec_command|command|process/.test(tool)) return 'command';
  if (/file|read|write|directory|文件/.test(tool)) return 'file';
  if (/search|搜索/.test(tool)) return 'search';
  if (/mcp/.test(tool)) return 'mcp';
  if (/skill|技能/.test(tool)) return 'skill';
  return 'tool';
}
