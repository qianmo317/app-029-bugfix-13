/**
 * 本地存储（无后端）：项目、预设、字库偏好。
 * 只落 localStorage，不发起任何网络请求。
 */

import materialsData from '../data/materials.json'
import type { Preset } from './materials'
import { defaultProject } from './layout'
import type { Project } from './types'

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
  const list = readJson<Project[]>(KEY_PROJECTS, [])
  // 同一个门头只留一条（保留 updatedAt 最新者），并按最近改动排在最前
  const byId = new Map<string, Project>()
  for (const p of list) {
    if (!p || typeof p.id !== 'string') continue
    const old = byId.get(p.id)
    if (!old || (p.updatedAt ?? 0) > (old.updatedAt ?? 0)) byId.set(p.id, p)
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

export function getProject(id: string): Project | null {
  return listProjects().find((p) => p.id === id) ?? null
}

export function saveProject(p: Project): void {
  // 先按 id 去掉旧条目再放到最前：同一门头在列表里始终只有一条
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
  p.name = name
  // 新建门头采用「本地字库」页设置的当前默认字体与字重
  const prefs = loadPrefs()
  p.layout.settings.fontId = prefs.defaultFontId
  p.layout.settings.weight = prefs.defaultWeight
  saveProject(p)
  return p
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * 按段合并预设：存档里有的段盖上去、没有的段拿出厂值。
 * 对象段逐字段递归合并（旧存档缺字段时回落出厂值，如 psu.tiers / pricePerWattCents）；
 * 数组段（板材/模组/配件等）有存档则整段采用存档，否则用出厂值。
 */
function mergePreset(base: Preset, patch: Partial<Preset>): Preset {
  const merge = (b: unknown, s: unknown): unknown => {
    if (isPlainObject(b) && isPlainObject(s)) {
      const out: Record<string, unknown> = { ...b }
      for (const k of Object.keys(s)) {
        out[k] = k in b ? merge(b[k], s[k]) : s[k]
      }
      return out
    }
    return s === undefined ? b : s
  }
  return merge(base, patch) as Preset
}

export function defaultPresetDeep(): Preset {
  return JSON.parse(JSON.stringify(materialsData)) as Preset
}

export function loadPreset(): Preset {
  const saved = readJson<Partial<Preset> | null>(KEY_PRESET, null)
  if (!saved || typeof saved !== 'object') return defaultPresetDeep()
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