/** Translate the official verifier footer without hiding a failed write. */
export function chatFileFailureNotice(content: string, chinese: boolean): string {
  if (!chinese) return content;
  const marker = content.indexOf('File-mutation verifier:');
  if (marker < 0) return content;
  const start = content.lastIndexOf('\n', marker) + 1;
  const lines = content.slice(start).split('\n');
  const details = lines.slice(1).map(line => {
    const item = line.match(/^\s*•\s*(`[^`]+`)\s*—\s*\[[^\]]+\]\s*(.*)$/);
    if (!item) return line;
    const reason = /permission denied|access is denied/i.test(item[2])
      ? '没有写入权限，文件未保存。' : item[2];
    return `- ${item[1]}：${reason}`;
  });
  return content.slice(0, start) + ['文件保存失败，以下文件尚未写入：', '', ...details].join('\n');
}
