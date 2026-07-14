import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

export interface NativeFrontendAttachment {
  id: string;
  name: string;
  uri: string;
}

type NativeAttachmentAction = 'camera' | 'file-picker' | 'photo-library';

export async function pickNativeFrontendAttachments(
  action: NativeAttachmentAction,
  currentCount: number,
): Promise<NativeFrontendAttachment[] | null> {
  if (action === 'file-picker') {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return null;
    const stamp = Date.now();
    return result.assets.map((asset, index) => ({
      id: `file-${stamp}-${index}-${asset.uri}`,
      name: asset.name,
      uri: asset.uri,
    }));
  }

  const result = action === 'camera'
    ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ['images'],
        quality: 1,
        selectionLimit: 0,
      });
  if (result.canceled) return null;
  const stamp = Date.now();
  return result.assets.map((asset, index) => ({
    id: `image-${stamp}-${index}-${asset.assetId ?? asset.uri}`,
    name: asset.fileName ?? `照片 ${currentCount + index + 1}`,
    uri: asset.uri,
  }));
}
