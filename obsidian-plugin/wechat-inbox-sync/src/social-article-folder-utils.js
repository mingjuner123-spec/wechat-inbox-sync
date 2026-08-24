'use strict';

function requireFunction(value, name) {
  if (typeof value !== 'function') {
    throw new TypeError(`social article folder dependency is required: ${name}`);
  }
  return value;
}

function createSocialArticleFolderAlignmentHelpers(dependencies = {}) {
  const normalizeVaultPath = requireFunction(dependencies.normalizeVaultPath, 'normalizeVaultPath');
  const sanitizeAttachmentName = requireFunction(dependencies.sanitizeAttachmentName, 'sanitizeAttachmentName');
  const shouldStoreWebpageNoteInOwnFolder = requireFunction(
    dependencies.shouldStoreWebpageNoteInOwnFolder,
    'shouldStoreWebpageNoteInOwnFolder',
  );
  const onWarning = typeof dependencies.onWarning === 'function'
    ? dependencies.onWarning
    : () => {};

  async function alignSocialArticleImageFolder(record, {
    sourceUrl,
    noteDir,
    assetFolderTitle,
    fileTitle,
    storageMode,
    adapter,
  } = {}) {
    const targetFolderName = sanitizeAttachmentName(fileTitle, '文章');
    if (!shouldStoreWebpageNoteInOwnFolder(sourceUrl, storageMode)) {
      return { record, folderName: targetFolderName };
    }

    const sourceFolderName = sanitizeAttachmentName(assetFolderTitle, '文章');
    if (sourceFolderName === targetFolderName) {
      return { record, folderName: targetFolderName };
    }

    const sourceFolderPath = normalizeVaultPath(`${noteDir}/${sourceFolderName}`);
    const targetFolderPath = normalizeVaultPath(`${noteDir}/${targetFolderName}`);
    const sourceImageFolderPath = normalizeVaultPath(`${sourceFolderPath}/文章图片`);
    const targetImageFolderPath = normalizeVaultPath(`${targetFolderPath}/文章图片`);
    const sourceImagePath = `${sourceImageFolderPath}/`;
    const targetImagePath = `${targetImageFolderPath}/`;
    const sourceFallback = { record, folderName: sourceFolderName };
    const metadata = record && record.metadata && typeof record.metadata === 'object'
      ? record.metadata
      : {};
    const metadataFields = ['markdown', 'snapshot', 'contentSnapshot'];
    const metadataReferencesPath = (path) => metadataFields
      .some((field) => typeof metadata[field] === 'string' && metadata[field].includes(path));
    const rewriteRecordImagePaths = () => {
      const nextMetadata = { ...metadata };
      metadataFields.forEach((field) => {
        if (typeof nextMetadata[field] === 'string') {
          nextMetadata[field] = nextMetadata[field].split(sourceImagePath).join(targetImagePath);
        }
      });
      return {
        record: { ...record, metadata: nextMetadata },
        folderName: targetFolderName,
        sourceImagePath,
        targetImagePath,
      };
    };

    if (!adapter || typeof adapter.rename !== 'function' || typeof adapter.exists !== 'function') {
      return sourceFallback;
    }

    try {
      const sourceImagesExist = await adapter.exists(sourceImageFolderPath);
      if (!sourceImagesExist) {
        const targetImagesExist = await adapter.exists(targetImageFolderPath);
        if (targetImagesExist) {
          // Assets already live under the final title. Late-rendered metadata
          // can still contain the source path, so normalize it before writing.
          return metadataReferencesPath(sourceImagePath)
            ? rewriteRecordImagePaths()
            : { record, folderName: targetFolderName };
        }
        if (metadataReferencesPath(targetImagePath)) {
          return { record, folderName: targetFolderName };
        }
        if (metadataReferencesPath(sourceImagePath)) {
          // The metadata still expects source assets that are not currently
          // visible. Preserve those references and keep the note beside their
          // expected source folder rather than manufacturing a dangling layout.
          return sourceFallback;
        }
        // No local article-image assets or references exist. Keep the normal
        // final-title note layout instead of retaining a temporary share ID.
        return { record, folderName: targetFolderName };
      }

      // Never merge into or overwrite a pre-existing final-title folder. Keep
      // the note with the source attachments and their unchanged references.
      if (await adapter.exists(targetFolderPath)) {
        return sourceFallback;
      }

      await adapter.rename(sourceFolderPath, targetFolderPath);
      return rewriteRecordImagePaths();
    } catch (error) {
      onWarning(error);
      return sourceFallback;
    }
  }

  return { alignSocialArticleImageFolder };
}

module.exports = { createSocialArticleFolderAlignmentHelpers };
