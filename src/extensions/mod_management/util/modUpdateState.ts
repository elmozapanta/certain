import { getSafe } from '../../../util/storeHelper';
import { truthy } from '../../../util/util';
import { IDownload } from '../../download_management/types/IDownload';
import { IMod } from '../types/IMod';
import { IModSource } from '../types/IModSource';
import { getModSource } from '../util/modSource';

import versionClean from './versionClean';

export function isIdValid(mod: IMod) {
  if (mod.attributes?.source === undefined) {
    return false;
  }

  const source: IModSource = getModSource(mod.attributes?.source);

  return (mod.state !== 'installed')
      // if the source doesn't support identifying individual mods (versions of mods)
      || (source?.options?.supportsModId !== true)
      || (mod.type === 'collection')
      || (mod.attributes?.fileId !== undefined)
      || (mod.attributes?.revisionId !== undefined);
}

export function isDownloadIdValid(download: IDownload) {
  if (download?.modInfo?.source === undefined) {
    return false;
  }

  const source: IModSource = getModSource(download.modInfo.source);

  return (download.state !== 'finished')
      // if the source doesn't support identifying individual mods (versions of mods)
      || (source?.options?.supportsModId !== true)
      || (download.modInfo.ids?.modId !== undefined)
      || (download.modInfo.meta?.details?.modId !== undefined)
      // collections always come from nexus mods
      || (download.modInfo.nexus?.ids?.collectionSlug !== undefined);
}

export type UpdateState =
  'bug-update' | 'bug-update-site' | 'bug-disable' |
  'update' | 'update-site' | 'current' | 'install';

function updateState(attributes: { [id: string]: any }): UpdateState {
  if (!truthy(getSafe(attributes, ['source'], undefined))) {
    // if no source associated there can't be an update
    return 'current';
  }
  const fileId: number = getSafe(attributes, ['fileId'], undefined);
  const version: string = getSafe(attributes, ['version'], undefined);
  const newestFileId: number | 'unknown' = getSafe(attributes, ['newestFileId'], undefined);
  const newestVersion: string = getSafe(attributes, ['newestVersion'], undefined);
  const bugMessage: string = getSafe(attributes, ['bugMessage'], undefined);

  // for mods we point out any change in version number including downgrades because we
  // can't make assumptions on the versioning scheme and because downgrades may be intended.
  // For collections that's different, it's always a number and we don't support downgrades
  const hasNewerVersion = (attributes.revisionId !== undefined)
    ? parseInt(newestVersion ?? '0', 10) > parseInt(version ?? '0', 10)
    : (newestVersion !== undefined) && (version !== undefined)
      && (versionClean(newestVersion) !== versionClean(version));

  // installed file is in the OLD_VERSION group or not available at all
  const hasUpdate = (newestFileId === 'unknown')
    // we know the newest file id and the current file id and they are not the same
    || (truthy(newestFileId)
        && truthy(fileId)
        && (newestFileId.toString() !== fileId.toString()))
    // we know the newest version and the current version and the are not the same
    || hasNewerVersion;

  if (hasUpdate) {
    // if the newest file id is unknown this means there *is* an update (according to the
    // site-specific update mechanism) but we don't know which file it is
    if (newestFileId === 'unknown') {
      return bugMessage ? 'bug-update-site' : 'update-site';
    } else {
      return bugMessage ? 'bug-update' : 'update';
    }
  } else {
    return bugMessage ? 'bug-disable' : 'current';
  }
}

export default updateState;
