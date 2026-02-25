import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import Summary from './parse/Summary'
import { getKnowledgeBaseInfo, getDocsListWithUpdateTime } from './api'
import { fixPath } from './parse/fix'
import { ProgressBar, isValidUrl, logger } from './utils'
import { downloadArticleList } from './download/list'

import type { ICliOptions, IProgressItem } from './types'

export async function main(url: string, options: ICliOptions) {
  if (!isValidUrl(url)) {
    throw new Error('Please enter a valid URL')
  }
  const {
    bookId,
    tocList,
    bookName,
    bookDesc,
    bookSlug,
    host,
    imageServiceDomains
  } = await getKnowledgeBaseInfo(url, {
    token: options.token,
    key: options.key
  })
  if (!bookId) throw new Error('No found book id')
  if (!tocList || tocList.length === 0) throw new Error('No found toc list')
  const bookPath = path.resolve(options.distDir, bookName ? fixPath(bookName) : String(bookId))

  await mkdir(bookPath, {recursive: true})

  const total = tocList.length
  const progressBar = new ProgressBar(bookPath, total)
  await progressBar.init()

  const uuidMap = new Map<string, IProgressItem>()
  // 始终加载已有进度，支持断点续传和增量下载
  if (progressBar.isDownloadInterrupted || progressBar.progressInfo.length > 0) {
    progressBar.progressInfo.forEach(item => {
      uuidMap.set(
        item.toc.uuid,
        item
      )
    })
  }

  // 增量下载优化：预先获取所有文档的更新时间，避免逐篇请求API
  let docsUpdateTimeMap: Map<string, { content_updated_at: string }> | undefined
  if (progressBar.progressInfo.length > 0) {
    logger.info('正在获取文档更新时间列表...')
    try {
      docsUpdateTimeMap = await getDocsListWithUpdateTime(bookId, {
        token: options.token,
        key: options.key
      }, host)
      logger.info(`获取到 ${docsUpdateTimeMap.size} 篇文档的更新时间`)
    } catch (e) {
      logger.warn('获取文档更新时间列表失败，将使用逐篇检查模式')
    }
  }

  const articleUrlPrefix = url.replace(new RegExp(`(.*?/${bookSlug}).*`), '$1')
  // 下载文章列表
  await downloadArticleList({
    articleUrlPrefix,
    total,
    uuidMap,
    tocList,
    bookPath,
    bookId,
    progressBar,
    host,
    options,
    imageServiceDomains,
    docsUpdateTimeMap
  })

  // 生成目录
  const summary = new Summary({
    bookPath,
    bookName,
    bookDesc,
    uuidMap
  })
  await summary.genFile()
  logger.info(`√ 生成目录 ${path.resolve(bookPath, 'index.md')}`)

  if (progressBar.curr === total) {
    logger.info(`√ 已完成: ${bookPath}`)
  }
}
