/**
 * 本地存储（无后端）：项目、预设、字库偏好。
 * 只落 localStorage，不发起任何网络请求。
 */

import materialsData from '../data/materials.json'
import { findFont } from './fontLoader'
import type { Preset } from './materials'
import { defaultProject, textToItems } from './layout'
import type { Align, Project } from './types'

const KEY_PROJECTS = 'app029.projects.v1'
const KEY_PRESET = 'app029.preset.v1'
const KEY_PREFS = 'app029.prefs.v1'

export interface Prefs {
  defaultFontId: string
  defaultWeight: number
  nightPreview: boolean
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 存储空间不足等异常：忽略写入失败，不影响当前会话使用
  }
}

export function listProjects(): Project[] {
  const raw = readJson<Project[]>(KEY_PROJECTS, [])
  // 同一个门头只留一条（历史脏数据可能同 id 多条：保留 updatedAt 最新者），按最近改动排在最前
  const byId = new Map<string, Project>()
  for (const p of raw) {
    const prev = byId.get(p.id)
    if (!prev || (p.updatedAt ?? 0) >= (prev.updatedAt ?? 0)) byId.set(p.id, p)
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function getProject(id: string): Project | null {
  return listProjects().find((p) => p.id === id) ?? null
}

export function saveProject(p: Project): void {
  // 先移除同 id 旧记录再置顶：同一个门头只留一条，且最近改动排在最前
  const list = listProjects().filter((x) => x.id !== p.id)
  list.unshift({ ...p, updatedAt: Date.now() })
  writeJson(KEY_PROJECTS, list)
}

export function deleteProject(id: string): void {
  writeJson(
    KEY_PROJECTS,
    listProjects().filter((p) => p.id !== id)
  )
}

export function duplicateProject(id: string): Project | null {
  const src = getProject(id)
  if (!src) return null
  const copy: Project = JSON.parse(JSON.stringify(src))
  copy.id = newId()
  copy.name = `${src.name} 副本`
  copy.createdAt = Date.now()
  copy.updatedAt = Date.now()
  saveProject(copy)
  return copy
}

export function newId(): string {
  return `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function createProject(name: string, panel?: { wMm?: number; hMm?: number; frameMm?: number }): Project {
  const p = defaultProject(newId(), panel)
  const font = defaultFontPref()
  p.name = name
  // 新建门头采用当前设置的默认字体与字重
  p.layout.settings.fontId = font.fontId
  p.layout.settings.weight = font.weight
  saveProject(p)
  return p
}

/**
 * 把同一套排版参数（字体/字重/字号/对齐/字距比例）统一应用到多个项目：
 * 逐个修改并写回本机存储，返回实际生效的项目数。
 */
export function applyUnifiedLayout(
  ids: string[],
  unify: { fontId: string; weight: number; baseSizeMm: number; align: Align; trackRatio: number }
): number {
  const want = new Set(ids)
  let count = 0
  for (const target of listProjects()) {
    if (!want.has(target.id)) continue
    target.layout.settings.fontId = unify.fontId
    target.layout.settings.weight = unify.weight
    target.layout.settings.baseSizeMm = unify.baseSizeMm
    target.layout.settings.align = unify.align
    target.layout.settings.trackRatio = unify.trackRatio
    // 保留原有分行：按 line 重建文本后逐字重排（未手动调过的字距跟随新字距比例）
    const lines: string[] = []
    for (const it of target.layout.items) {
      while (lines.length <= it.line) lines.push('')
      lines[it.line] += it.char
    }
    target.layout.items = textToItems(lines.join('\n'), target.layout.items, target.layout.settings, unify.baseSizeMm)
    saveProject(target)
    count++
  }
  return count
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 按段合并：存档里有的段盖上去、没有的段拿出厂值。
 * 普通对象（如 process / psu）逐字段递归合并，缺字段回落出厂值；
 * 数组（板材/模组/配件等清单）作为整段以存档为准。
 */
function mergeSection<T>(base: T, patch: unknown): T {
  if (patch === undefined || patch === null) return base
  if (isPlainObject(base) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...base }
    for (const k of Object.keys(patch)) {
      out[k] = k in base ? mergeSection((base as Record<string, unknown>)[k], patch[k]) : patch[k]
    }
    return out as T
  }
  return patch as T
}

function mergePreset(base: Preset, patch: Partial<Preset>): Preset {
  return mergeSection(base, patch)
}

export function defaultPresetDeep(): Preset {
  return JSON.parse(JSON.stringify(materialsData)) as Preset
}

export function loadPreset(): Preset {
  const saved = readJson<Partial<Preset> | null>(KEY_PRESET, null)
  if (!saved) return defaultPresetDeep()
  return mergePreset(defaultPresetDeep(), saved)
}

export function savePreset(preset: Preset): void {
  writeJson(KEY_PRESET, preset)
}

export function resetPreset(): Preset {
  const fresh = defaultPresetDeep()
  writeJson(KEY_PRESET, fresh)
  return fresh
}

export function loadPrefs(): Prefs {
  return readJson<Prefs>(KEY_PREFS, { defaultFontId: 'hei', defaultWeight: 400, nightPreview: false })
}

export function savePrefs(p: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...p }
  writeJson(KEY_PREFS, next)
  return next
}

/**
 * 当前默认字体与字重（新建门头采用）。
 * 若偏好指向已不可用的字体（如仅当前会话有效的上传字体），回退黑体 400。
 */
export function defaultFontPref(): { fontId: string; weight: number } {
  const prefs = loadPrefs()
  const f = findFont(prefs.defaultFontId)
  if (!f || f.weights.length === 0) return { fontId: 'hei', weight: 400 }
  const weight = f.weights.some((w) => w.weight === prefs.defaultWeight) ? prefs.defaultWeight : f.weights[0].weight
  return { fontId: f.id, weight }
}
