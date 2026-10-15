import { Capacitor } from '@capacitor/core';
import { ZapdropNative, NativeMediaType } from '../native/zapdrop-native';
import { DeviceFile, FileCategory, FolderNode } from '../types';
import { MOCK_FILES, MOCK_FOLDERS, USE_MOCK } from './mock';

export async function loadFolders(): Promise<FolderNode[]> {
  if (USE_MOCK) {
    return MOCK_FOLDERS;
  }

  try {
    const { buckets } = await ZapdropNative.listBuckets();
    return buckets.map((b) => ({
      name: b.name,
      path: b.path,
      icon: b.name.toLowerCase().includes('camera')
        ? 'camera'
        : b.name.toLowerCase().includes('download')
        ? 'download'
        : b.name.toLowerCase().includes('video') || b.name.toLowerCase().includes('movie')
        ? 'video'
        : b.name.toLowerCase().includes('music') || b.name.toLowerCase().includes('audio')
        ? 'music'
        : 'folder',
      itemsCount: b.count,
      totalSize: `${b.count} files`,
    }));
  } catch (e) {
    console.warn('Failed to list native buckets, using fallback', e);
    return MOCK_FOLDERS;
  }
}

export async function loadFiles(
  category: FileCategory = 'all',
  bucket?: string,
  query?: string,
  page = 0
): Promise<DeviceFile[]> {
  if (USE_MOCK) {
    let filtered = [...MOCK_FILES];
    if (category !== 'all') {
      filtered = filtered.filter((f) => f.category === category);
    }
    if (query) {
      filtered = filtered.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()));
    }
    return filtered;
  }

  let nativeType: NativeMediaType = 'all';
  if (category === 'images') nativeType = 'image';
  else if (category === 'videos') nativeType = 'video';
  else if (category === 'audio') nativeType = 'audio';
  else if (category === 'documents') nativeType = 'doc';
  else if (category === 'apps') nativeType = 'app';

  try {
    const { items } = await ZapdropNative.listMedia({
      type: nativeType,
      bucket,
      query,
      limit: 60,
      offset: page * 60,
    });

    return items.map((i) => {
      let mappedCategory: FileCategory = 'documents';
      if (i.type === 'image') mappedCategory = 'images';
      else if (i.type === 'video') mappedCategory = 'videos';
      else if (i.type === 'audio') mappedCategory = 'audio';
      else if (i.type === 'app') mappedCategory = 'apps';

      const ext = i.name.includes('.') ? i.name.split('.').pop() || '' : '';

      return {
        id: i.id,
        name: i.name,
        path: i.webPath || i.uri,
        size: i.size,
        modifiedDate: new Date(i.modified).toLocaleDateString(),
        category: mappedCategory,
        mimeType: i.mime,
        isDirectory: false,
        previewUrl: i.type === 'image' || i.type === 'video' ? Capacitor.convertFileSrc(i.webPath) : undefined,
        extension: ext,
        nativeUri: i.uri,
      };
    });
  } catch (e) {
    console.warn('Failed to list native media, falling back', e);
    return MOCK_FILES;
  }
}
