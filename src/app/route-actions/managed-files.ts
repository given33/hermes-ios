import type { HermesCloudApi } from '../../api/HermesCloudApi';
import {
  HERMES_SWIFTUI_ROUTE_ACTIONS,
  type HermesSwiftUIRouteActionEvent,
} from '../swiftui-route-contract';
import { fileNameFromUri, presentManagedFile, removeStagedFileImport } from './presentation';

export type ManagedFilesActionResult = 'reload' | 'none' | {
  managedFilesJSON?: string;
  message: string;
};

/** Execute the managed-workspace file actions kept separate from the large
 * route coordinator. Account cloud files continue to use their own actions. */
export async function performManagedFilesAction(
  api: HermesCloudApi,
  event: HermesSwiftUIRouteActionEvent,
): Promise<ManagedFilesActionResult | undefined> {
  const { action, payload } = event;
  const value = payload.value?.trim() || payload.name?.trim() || payload.id?.trim() || '';
  switch (action) {
    case HERMES_SWIFTUI_ROUTE_ACTIONS.managedFilesOpen: {
      const result = await api.listFiles(value);
      return { message: '', managedFilesJSON: JSON.stringify(result) };
    }
    case HERMES_SWIFTUI_ROUTE_ACTIONS.managedFileDownload:
      if (!value) return 'none';
      await presentManagedFile(api, value, payload.name || fileNameFromUri(value));
      return 'none';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.managedFileDelete:
      if (!value) return 'none';
      await api.deleteFile(value, payload.enabled === true);
      return 'reload';
    case HERMES_SWIFTUI_ROUTE_ACTIONS.managedFileImport:
      if (!value || !payload.uris?.length) return 'none';
      for (const uri of payload.uris) {
        try {
          const name = fileNameFromUri(uri);
          await api.uploadManagedFile(
            `${value.replace(/[\\/]$/, '')}/${name}`,
            { name, uri },
            true,
          );
        } finally {
          if (payload.fields?.stagedImport === 'true') await removeStagedFileImport(uri);
        }
      }
      return 'reload';
    default:
      return undefined;
  }
}
