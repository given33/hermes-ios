export async function readVoiceRecording(uri: string): Promise<{ dataUrl: string; mimeType: string }> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error('Unable to read the voice recording');
  const blob = await response.blob();
  const mimeType = blob.type || 'audio/webm';
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Unable to read the voice recording'));
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result) : reject(new Error('Empty voice recording'));
    reader.readAsDataURL(blob);
  });
  return { dataUrl, mimeType };
}

export function releaseVoiceRecording(uri: string): void {
  if (uri.startsWith('blob:')) URL.revokeObjectURL(uri);
}
