/**
 * Ciclo di salary review: organico, budget a cascata, vincoli e stati di approvazione.
 * La logica è pura così la scheda può ricalcolare il residuo a ogni modifica.
 * Le opzioni nuove restano disattivabili: i default della cascata piatta coincidono col comportamento precedente.
 */
import { DEFAULT_ANNUAL_HOURS, MIN_GENDER_SAMPLE, gapSampleSufficient, genderPayGapPct } from './salaryMetrics.js'

export const LEVERS = [
  { id: 'merit', label: 'Aumento di merito' },
  { id: 'oneoff', label: 'Una tantum' },
  { id: 'promotion', label: 'Promozione / cambio livello' },
]

export const STATUS_LABEL = {
  draft: 'Bozza',
  pending_l2: 'In attesa del responsabile',
  pending_hrbp: 'In attesa HRBP',
  pending_hr: 'In attesa HR',
  approved: 'Approvato',
  rejected: 'Respinto',
}

export const MOTIVATIONS = [
  { id: 'market', label: 'Mercato' },
  { id: 'retention', label: 'Retention' },
  { id: 'critical', label: 'Competenze critiche' },
  { id: 'equity', label: 'Riallineamento equità' },
  { id: 'other', label: 'Altro' },
]

export const MATRIX_COLUMNS = [
  { id: 'below', label: 'Sotto il minimo' },
  { id: 'low', label: 'Parte bassa' },
  { id: 'high', label: 'Parte alta' },
  { id: 'above', label: 'Sopra il massimo' },
]

export const RULE_FIELDS = [
  { id: 'personCap', label: 'Tetto per persona' },
  { id: 'levers', label: 'Leve consentite' },
  { id: 'aboveBand', label: 'Sopra la soglia di compa-ratio' },
  { id: 'matrix', label: 'Merit matrix' },
]

export const OWNERSHIP_OPTIONS = [
  { id: 'hr', label: 'Fissata da HR' },
  { id: 'default', label: 'Predefinita, modificabile dal manager' },
  { id: 'manager', label: 'Decide il manager' },
]

export const BAND_SOURCE_LABEL = {
  weighting: 'Pesatura Transparency',
  ccnlFamily: 'Livello CCNL + job family',
  level: 'Pari livello CCNL',
  policy: 'Banda definita',
  peers: 'Pari livello CCNL',
  none: 'Non disponibile',
}

export function defaultMatrix() {
  return {
    enabled: true,
    mode: 'indicative',
    tolerancePct: 1,
    rows: [
      { id: 'high', label: 'Alta (90–100)', min: 90, max: 100 },
      { id: 'solid', label: 'Solida (75–89)', min: 75, max: 89 },
      { id: 'mid', label: 'Nella media (60–74)', min: 60, max: 74 },
      { id: 'low', label: 'Sotto le attese (0–59)', min: 0, max: 59 },
    ],
    cells: {
      high: { below: 6, low: 4.5, high: 3, above: 1.5 },
      solid: { below: 4.5, low: 3.5, high: 2.5, above: 1 },
      mid: { below: 3, low: 2, high: 1.5, above: 0.5 },
      low: { below: 1.5, low: 1, high: 0, above: 0 },
    },
    noPerf: { below: 3, low: 2, high: 1, above: 0 },
  }
}

export function defaultRuleOwnership() {
  return { personCap: 'hr', levers: 'hr', aboveBand: 'hr', matrix: 'hr' }
}

export function defaultEnabledLevers() {
  return { merit: true, oneoff: true, promotion: true }
}

export function defaultSettings(today = new Date()) {
  const iso = toIsoDate(today)
  const year = today.getFullYear()
  return {
    cycleName: `Salary review ${year}`,
    poolMode: 'percent',
    poolPercent: 3,
    poolAbsolute: 0,
    allocationMode: 'percent',
    weightBasis: 'compa',
    cascadeMode: 'flat',
    unusedPolicy: 'return',
    budgetMode: 'unified',
    leverSplit: { merit: 70, oneoff: 15, promotion: 15 },
    enabledLevers: defaultEnabledLevers(),
    ruleOwnership: defaultRuleOwnership(),
    personCapPct: 10,
    overBudget: 'alert',
    newHireMonths: 6,
    aboveBandPolicy: 'alert',
    aboveBandCompa: 110,
    gapAlertPct: 5,
    matrix: defaultMatrix(),
    bandSource: 'weighting',
    bandEdits: {},
    secondApprover: 'manager',
    referenceDate: iso,
    effectiveDate: defaultEffectiveDate(today),
  }
}

export function mergeSettings(base, stored) {
  if (!stored || typeof stored !== 'object') return base
  const matrix = defaultMatrix()
  const incoming = stored.matrix || {}
  return {
    ...base,
    ...stored,
    leverSplit: { ...base.leverSplit, ...(stored.leverSplit || {}) },
    enabledLevers: { ...base.enabledLevers, ...(stored.enabledLevers || {}) },
    ruleOwnership: { ...base.ruleOwnership, ...(stored.ruleOwnership || {}) },
    bandEdits: stored.bandEdits && typeof stored.bandEdits === 'object' ? stored.bandEdits : {},
    matrix: {
      ...matrix,
      ...incoming,
      rows: matrix.rows,
      cells: mergeCells(matrix.cells, incoming.cells),
      noPerf: { ...matrix.noPerf, ...(incoming.noPerf || {}) },
    },
  }
}

function mergeCells(base, stored) {
  const out = {}
  for (const rowId of Object.keys(base)) {
    out[rowId] = { ...base[rowId], ...(stored?.[rowId] || {}) }
  }
  return out
}

/** Esempio: cascata su due livelli, una leva spenta, una proposta fuori matrice. */
export function demoSeed() {
  return {
    settings: {
      cascadeMode: 'hierarchy',
      ruleOwnership: { ...defaultRuleOwnership(), levers: 'default' },
    },
    managerRules: {
      giulia: { levers: { merit: true, oneoff: true, promotion: false } },
    },
    proposals: {
      lbianchi: {
        lever: 'merit',
        amount: 2500,
        newLevel: '',
        motivation: 'critical',
        motivationNote: 'Competenze di analisi difficili da reperire sul mercato interno.',
      },
      marta: {
        lever: 'merit',
        amount: 2000,
        newLevel: '',
        motivation: 'retention',
        motivationNote: 'Offerta esterna sul ruolo di senior key account.',
      },
    },
  }
}

export function emptyPackage() {
  return { status: 'draft', comment: '', history: [] }
}

export function emptyProposal() {
  return { lever: 'merit', amount: 0, newLevel: '', motivation: '', motivationNote: '' }
}

export function formatEuro(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0 €'
  return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
}

export function formatPct(n, digits = 1) {
  const v = Number(n)
  if (!Number.isFinite(v)) return '0%'
  return `${v.toLocaleString('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`
}

export function leverLabel(id) {
  return LEVERS.find((l) => l.id === id)?.label || 'Aumento di merito'
}

export function motivationLabel(id) {
  return MOTIVATIONS.find((item) => item.id === id)?.label || ''
}

export function allocationFormula(settings) {
  if (settings?.allocationMode === 'absolute') {
    return 'HR inserisce l’importo di ogni responsabile. Il totale si confronta con il pool. In tabella lo scostamento è rispetto al riparto proporzionale al monte salari.'
  }
  if (settings?.allocationMode === 'weighted' && settings?.weightBasis === 'performance') {
    return 'budget = pool × (monte × fattore) / Σ (monte × fattore). Fattore = performance media / 100, con minimo 0,25. Senza valutazione il fattore è 1, quindi il team non viene né premiato né penalizzato.'
  }
  if (settings?.allocationMode === 'weighted') {
    return 'budget = pool × (monte × 100 / compa medio) / Σ (monte × 100 / compa medio). Un compa medio più basso pesa di più. Senza compa il fattore è 1.'
  }
  return 'Ogni perimetro riceve la stessa percentuale del proprio monte salari. Finché le righe restano in automatico, la somma dei budget coincide con il pool.'
}

export function dateOrderError(settings) {
  if (!settings?.effectiveDate || !settings?.referenceDate) return ''
  if (settings.effectiveDate < settings.referenceDate) {
    return 'La decorrenza degli aumenti non può precedere la data di riferimento per l’eleggibilità.'
  }
  return ''
}

function defaultEffectiveDate(today) {
  const iso = toIsoDate(today)
  const year = today.getFullYear()
  const july = `${year}-07-01`
  return july >= iso ? july : `${year + 1}-01-01`
}

function toIsoDate(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthsAgo(months, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth() - months, Math.min(from.getDate(), 28))
  return toIsoDate(d)
}

export function parseEuroInput(raw) {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  let s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/€/g, '')
  if (!s) return 0
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

export function monthsBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null
  const a = new Date(`${fromIso}T00:00:00`)
  const b = new Date(`${toIso}T00:00:00`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) months -= 1
  return months
}

export function normalizeHireDate(value) {
  if (value == null || value === '' || value === 'N/D') return null
  if (value instanceof Date) return toIsoDate(value)
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000)
    return toIsoDate(utc)
  }
  const s = String(value).trim()
  const dmy = s.match(/^(\d{1,2})[/. -](\d{1,2})[/. -](\d{2,4})$/)
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${year}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  }
  return toIsoDate(s)
}

function salaryOf(person) {
  const raw = Number(person?.baseSalaryRaw)
  if (raw > 0) return raw
  const levelPay = Number(person?.livelloRetributivo)
  if (levelPay > 0) return levelPay
  const base = Number(person?.baseSalary)
  if (base > 0) return base
  const total = Number(person?.totalSalary)
  return total > 0 ? total : 0
}

function normalizeGender(value) {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
  if (['m', 'male', 'uomo', 'u', 'maschio'].includes(s)) return 'M'
  if (['f', 'female', 'donna', 'd', 'femmina'].includes(s)) return 'F'
  return null
}

function resolvePerformance(person, evaluationScores) {
  const ext = evaluationScores?.[person?.id]
  if (ext != null && ext !== '' && Number.isFinite(Number(ext))) {
    return { value: Number(ext), origin: 'evaluation' }
  }
  if (person?.evaluationScore != null && Number.isFinite(Number(person.evaluationScore))) {
    return { value: Number(person.evaluationScore), origin: 'evaluation' }
  }
  if (person?.performance != null && Number.isFinite(Number(person.performance))) {
    return { value: Number(person.performance), origin: 'organico' }
  }
  if (person?.performanceScore != null && Number.isFinite(Number(person.performanceScore))) {
    return { value: Number(person.performanceScore), origin: 'organico' }
  }
  return { value: null, origin: 'none' }
}

export function peopleFromJobResults(jobResults) {
  const out = []
  const seen = new Set()
  for (const level of jobResults || []) {
    for (const person of level?.people || []) {
      if (!person || seen.has(person.index)) continue
      if (person.terminationDate) continue
      const ral = salaryOf(person)
      if (ral <= 0) continue
      seen.add(person.index)
      const performance = resolvePerformance(person)
      out.push({
        id: `emp-${person.index}`,
        name: person.name ? String(person.name).trim() : `Dipendente ${person.index}`,
        role: person.role ? String(person.role).trim() : 'Ruolo non indicato',
        level: person.level ? String(person.level).trim() : 'N/D',
        ral,
        performance: performance.value,
        performanceOrigin: performance.origin,
        evaluationScore: person.evaluationScore ?? null,
        hireDate: normalizeHireDate(person.hireDate),
        lastIncreasePct: null,
        lastIncreaseDate: null,
        category: person.category ? String(person.category).trim() : 'Non assegnato',
        jobFamily: person.jobFamily
          ? String(person.jobFamily).trim()
          : person.category
            ? String(person.category).trim()
            : 'Non assegnata',
        gender: normalizeGender(person.gender),
        managerId: person.managerId ? String(person.managerId) : null,
        partTimePct: Number(person.partTimePct) > 0 ? Number(person.partTimePct) : 100,
        weightScore: person.trWeightedScore == null ? null : Number(person.trWeightedScore),
      })
    }
  }
  return out
}

function weightBucket(score) {
  const x = Math.min(100, Math.max(0, Math.round(Number(score) / 5) * 5))
  return `P${x}`
}

function bandGroupKey(person, mode) {
  if (mode === 'weight') return `W|${weightBucket(person.weightScore)}`
  if (mode === 'family') return `F|${person.level || 'N/D'}|${person.jobFamily || 'Non assegnata'}`
  return `L|${person.level || 'N/D'}`
}

function bandGroupLabel(key) {
  if (key.startsWith('W|')) return `Fascia pesatura ${key.slice(2)}`
  if (key.startsWith('F|')) {
    const [, level, family] = key.split('|')
    return `${level} · ${family}`
  }
  return key.slice(2)
}

function distributionBand(rals) {
  const sorted = rals.filter((n) => n > 0).sort((a, b) => a - b)
  if (sorted.length < 2) return null
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  return { min, max, mid: (min + max) / 2, estimated: sorted.length < 4 }
}

function annotatePeople(people, settings) {
  const source = settings?.bandSource || 'weighting'
  const edits = settings?.bandEdits || {}
  const anyWeight = people.some((p) => Number.isFinite(Number(p.weightScore)))
  const mode = source === 'ccnlFamily' ? 'family' : source === 'level' ? 'level' : anyWeight ? 'weight' : 'mixed'
  const groups = new Map()
  if (mode !== 'mixed') {
    for (const person of people) {
      const key = bandGroupKey(person, mode)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(person.ral)
    }
  } else {
    for (const person of people) {
      if (person.bandMid > 0) continue
      const key = bandGroupKey(person, 'level')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(person.ral)
    }
  }
  const stats = new Map()
  for (const [key, rals] of groups) {
    const edit = edits[key]
    const stat = distributionBand(rals)
    if (!stat && !(edit?.min > 0 && edit?.max > 0)) continue
    const min = edit?.min > 0 ? Number(edit.min) : stat.min
    const max = edit?.max > 0 ? Number(edit.max) : stat.max
    stats.set(key, { min, max, mid: (min + max) / 2, estimated: stat?.estimated ?? false, edited: !!(edit?.min > 0 || edit?.max > 0) })
  }
  return people.map((person) => {
    const explicit = mode === 'mixed' && person.bandMid > 0
    const key = bandGroupKey(person, mode === 'mixed' ? 'level' : mode)
    const stat = explicit ? null : stats.get(key)
    const bandMin = explicit ? person.bandMin : stat?.min ?? null
    const bandMid = explicit ? person.bandMid : stat?.mid ?? null
    const bandMax = explicit ? person.bandMax : stat?.max ?? null
    let bandSource = 'none'
    if (explicit) bandSource = 'policy'
    else if (stat && mode === 'weight') bandSource = 'weighting'
    else if (stat && mode === 'family') bandSource = 'ccnlFamily'
    else if (stat) bandSource = 'peers'
    if (!bandMid) {
      return { ...person, bandMin: null, bandMid: null, bandMax: null, compa: null, position: null, bandSource, bandKey: key }
    }
    const span = (bandMax || 0) - (bandMin || 0)
    const position = span > 0 ? (person.ral - bandMin) / span : 0.5
    return {
      ...person,
      bandMin,
      bandMid,
      bandMax,
      compa: (person.ral / bandMid) * 100,
      position,
      bandSource,
      bandKey: key,
      bandEdited: !!stat?.edited,
    }
  })
}

export function bandRows(people, settings) {
  const source = settings?.bandSource || 'weighting'
  const anyWeight = (people || []).some((p) => Number.isFinite(Number(p.weightScore)))
  const mode = source === 'ccnlFamily' ? 'family' : source === 'level' ? 'level' : anyWeight ? 'weight' : null
  if (!mode) return []
  const groups = new Map()
  for (const person of people || []) {
    const key = person.bandKey || bandGroupKey(person, mode)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(person)
  }
  return [...groups.entries()]
    .map(([key, members]) => {
      const sample = members[0]
      return {
        key,
        label: bandGroupLabel(key),
        n: members.length,
        min: sample?.bandMin ?? null,
        mid: sample?.bandMid ?? null,
        max: sample?.bandMax ?? null,
        edited: !!sample?.bandEdited,
      }
    })
    .filter((row) => row.n >= 1)
    .sort((a, b) => a.label.localeCompare(b.label, 'it'))
}

function withPersonMeta(person, evaluationScores) {
  const performance = resolvePerformance(person, evaluationScores)
  return {
    ...person,
    jobFamily: person.jobFamily || person.category || 'Non assegnata',
    gender: person.gender === 'M' || person.gender === 'F' ? person.gender : normalizeGender(person.gender),
    performance: performance.value,
    performanceOrigin: performance.origin,
    partTimePct: Number(person.partTimePct) > 0 ? Number(person.partTimePct) : 100,
  }
}

function demoPeople(today = new Date()) {
  const recent = monthsAgo(4, today)
  const c2 = { bandMin: 28000, bandMid: 34000, bandMax: 40000 }
  return [
    { id: 'luca', name: 'Luca Ferri', role: 'Sales Manager', level: 'Q', ral: 72000, managerId: 'elena', gender: 'M', performance: 86, hireDate: '2014-02-01', lastIncreasePct: 2.5, lastIncreaseDate: '2025-07-01', bandMin: 65000, bandMid: 74000, bandMax: 84000, category: 'Sales', jobFamily: 'Sales' },
    { id: 'giulia', name: 'Giulia Conti', role: 'Head of Product', level: 'Q', ral: 68000, managerId: 'elena', gender: 'F', performance: 91, hireDate: '2016-05-01', lastIncreasePct: 3, lastIncreaseDate: '2025-07-01', bandMin: 65000, bandMid: 74000, bandMax: 84000, category: 'Product', jobFamily: 'Product' },
    { id: 'marco', name: 'Marco De Santis', role: 'Operations Manager', level: 'Q', ral: 64000, managerId: 'elena', gender: 'M', performance: 78, hireDate: '2015-09-01', lastIncreasePct: 2, lastIncreaseDate: '2025-07-01', bandMin: 65000, bandMid: 74000, bandMax: 84000, category: 'Operations', jobFamily: 'Operations' },
    { id: 'andrea', name: 'Andrea Villa', role: 'Key Account', level: 'B3', ral: 42000, managerId: 'luca', gender: 'M', performance: 88, hireDate: '2019-03-01', lastIncreasePct: 3, lastIncreaseDate: '2025-07-01', bandMin: 36000, bandMid: 43000, bandMax: 50000, category: 'Sales', jobFamily: 'Sales' },
    { id: 'chiara', name: 'Chiara Neri', role: 'Account', level: 'C2', ral: 32000, managerId: 'luca', gender: 'F', performance: 74, hireDate: '2022-01-15', lastIncreasePct: 2, lastIncreaseDate: '2025-07-01', ...c2, category: 'Sales', jobFamily: 'Sales' },
    { id: 'davide', name: 'Davide Riva', role: 'Junior Account', level: 'D2', ral: 28000, managerId: 'luca', gender: 'M', performance: 91, hireDate: recent, lastIncreasePct: null, lastIncreaseDate: null, bandMin: 26000, bandMid: 30000, bandMax: 34000, category: 'Sales', jobFamily: 'Sales' },
    { id: 'marta', name: 'Marta Greco', role: 'Senior Key Account', level: 'B1', ral: 56000, managerId: 'luca', gender: 'F', performance: 96, hireDate: '2016-09-01', lastIncreasePct: 1.5, lastIncreaseDate: '2024-07-01', bandMin: 40000, bandMid: 47000, bandMax: 52000, category: 'Sales', jobFamily: 'Sales' },
    { id: 'paolo', name: 'Paolo Serra', role: 'Product Manager', level: 'B2', ral: 48000, managerId: 'giulia', gender: 'M', performance: 82, hireDate: '2018-04-01', lastIncreasePct: 4, lastIncreaseDate: '2025-07-01', bandMin: 42000, bandMid: 50000, bandMax: 58000, category: 'Product', jobFamily: 'Product' },
    { id: 'irene', name: 'Irene Fontana', role: 'Product Designer', level: 'C2', ral: 32000, managerId: 'giulia', gender: 'F', performance: 90, hireDate: '2021-11-01', lastIncreasePct: 2.5, lastIncreaseDate: '2025-07-01', ...c2, category: 'Product', jobFamily: 'Product' },
    { id: 'lbianchi', name: 'Luca Bianchi', role: 'Business Analyst', level: 'C2', ral: 36000, managerId: 'giulia', gender: 'M', performance: null, hireDate: '2020-02-01', lastIncreasePct: null, lastIncreaseDate: null, ...c2, category: 'Product', jobFamily: 'Product' },
    { id: 'sofia', name: 'Sofia Greco', role: 'Senior Product Manager', level: 'B1', ral: 61000, managerId: 'giulia', gender: 'F', performance: 70, hireDate: '2014-05-01', lastIncreasePct: 0, lastIncreaseDate: '2023-07-01', bandMin: 40000, bandMid: 47000, bandMax: 52000, category: 'Product', jobFamily: 'Product' },
    { id: 'fabio', name: 'Fabio Conti', role: 'Coordinator', level: 'B3', ral: 45000, managerId: 'marco', gender: 'M', performance: 77, hireDate: '2017-08-01', lastIncreasePct: 3, lastIncreaseDate: '2025-07-01', bandMin: 36000, bandMid: 43000, bandMax: 50000, category: 'Operations', jobFamily: 'Operations' },
    { id: 'erusso', name: 'Elena Russo', role: 'Specialist', level: 'C1', ral: 31000, managerId: 'marco', gender: 'F', performance: 85, hireDate: '2023-01-10', lastIncreasePct: 2, lastIncreaseDate: '2025-07-01', bandMin: 27000, bandMid: 32000, bandMax: 38000, category: 'Operations', jobFamily: 'Operations' },
    { id: 'giovanni', name: 'Giovanni Sala', role: 'Specialist', level: 'C2', ral: 36000, managerId: 'marco', gender: 'M', performance: 64, hireDate: '2019-12-01', lastIncreasePct: 1, lastIncreaseDate: '2025-07-01', ...c2, category: 'Operations', jobFamily: 'Operations' },
    { id: 'nora', name: 'Nora Vitale', role: 'Operations Lead', level: 'B2', ral: 52000, managerId: 'marco', gender: 'F', performance: 93, hireDate: '2015-03-15', lastIncreasePct: 3.5, lastIncreaseDate: '2025-07-01', bandMin: 42000, bandMid: 50000, bandMax: 58000, category: 'Operations', jobFamily: 'Operations' },
  ]
}

const DEMO_DIRECTORY = {
  elena: { id: 'elena', name: 'Elena Marini', role: 'Direttrice People & Reward', parentId: null, parentName: null, hrbpName: 'Sara Bellini', team: 'People & Reward' },
  luca: { id: 'luca', name: 'Luca Ferri', role: 'Sales Manager', parentId: 'elena', parentName: 'Elena Marini', hrbpName: 'Sara Bellini', team: 'Sales' },
  giulia: { id: 'giulia', name: 'Giulia Conti', role: 'Head of Product', parentId: 'elena', parentName: 'Elena Marini', hrbpName: 'Sara Bellini', team: 'Product' },
  marco: { id: 'marco', name: 'Marco De Santis', role: 'Operations Manager', parentId: 'elena', parentName: 'Elena Marini', hrbpName: 'Sara Bellini', team: 'Operations' },
}

function teamBuckets(people) {
  const groups = new Map()
  for (const person of people) {
    const key = (person.category || person.jobFamily || 'Non assegnato').trim() || 'Non assegnato'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(person)
  }
  const chunks = []
  for (const [label, members] of groups) {
    if (members.length > 8) {
      for (let i = 0; i < members.length; i += 6) {
        const slice = members.slice(i, i + 6)
        const suffix = Math.floor(i / 6) + 1
        chunks.push({ label: `${label} ${suffix}`, members: slice, small: slice.length < 2 })
      }
    } else {
      chunks.push({ label, members, small: members.length < 2 })
    }
  }
  const large = chunks.filter((c) => !c.small)
  const small = chunks.filter((c) => c.small)
  const merged = []
  let acc = []
  let labels = []
  const flush = () => {
    if (!acc.length) return
    merged.push({ label: labels.join(' · '), members: acc.slice() })
    acc = []
    labels = []
  }
  for (const chunk of small) {
    acc.push(...chunk.members)
    labels.push(chunk.label)
    if (acc.length >= 5) flush()
  }
  flush()
  return [...large.map((c) => ({ label: c.label, members: c.members })), ...merged].sort((a, b) =>
    a.label.localeCompare(b.label, 'it'),
  )
}

function signatureOf(people, usingDemo) {
  if (usingDemo) return 'demo'
  let hash = 0
  const raw = people.map((p) => `${p.id}:${p.managerId || ''}`).join('|')
  for (let i = 0; i < raw.length; i += 1) hash = (Math.imul(31, hash) + raw.charCodeAt(i)) | 0
  return `org-${people.length}-${hash >>> 0}`
}

function hierarchyCards(people, usingDemo) {
  const directory = usingDemo ? DEMO_DIRECTORY : {}
  const managerIds = new Set()
  for (const person of people) if (person.managerId) managerIds.add(String(person.managerId))
  for (const id of Object.keys(directory)) {
    if (people.some((p) => p.managerId === id)) managerIds.add(id)
  }
  const cards = []
  for (const id of managerIds) {
    const person = people.find((p) => p.id === id)
    const meta = directory[id] || {}
    const parentId = person?.managerId || meta.parentId || null
    const parentPerson = people.find((p) => p.id === parentId)
    cards.push({
      id,
      name: person?.name || meta.name || `Responsabile ${id}`,
      role: person?.role || meta.role || 'Manager',
      team: meta.team || person?.jobFamily || person?.category || 'Team',
      parentId,
      parentName: parentPerson?.name || meta.parentName || null,
      hrbpId: 'hrbp',
      hrbpName: meta.hrbpName || 'HRBP',
      reports: people.filter((p) => p.managerId === id),
    })
  }
  const cardIds = new Set(cards.map((c) => c.id))
  return cards
    .filter((card) => card.reports.length > 0 || cards.some((other) => other.parentId === card.id))
    .map((card) => ({
      ...card,
      parentId: card.parentId && cardIds.has(card.parentId) ? card.parentId : card.parentId && !cardIds.has(card.parentId) ? card.parentId : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

function actorsFor(cards) {
  const cardIds = new Set(cards.map((c) => c.id))
  const directors = new Set(cards.map((c) => c.parentId).filter((id) => cardIds.has(id)))
  const actors = [{ id: 'hr', name: 'HR', kind: 'hr', hint: 'Pool, calibrazione e approvazione finale' }]
  const ordered = [...cards].sort((a, b) => {
    const da = directors.has(a.id) ? 0 : 1
    const db = directors.has(b.id) ? 0 : 1
    if (da !== db) return da - db
    return a.name.localeCompare(b.name, 'it')
  })
  for (const card of ordered) {
    const director = directors.has(card.id)
    actors.push({
      id: card.id,
      name: card.name,
      kind: director ? 'director' : 'manager',
      hint: director ? 'Budget del perimetro e scheda' : 'Scheda del team',
    })
  }
  const parents = new Map()
  for (const card of cards) {
    if (card.parentId && !cardIds.has(card.parentId)) parents.set(card.parentId, card.parentName || 'Responsabile')
  }
  for (const [id, name] of parents) {
    actors.push({ id, name, kind: 'approver', hint: 'Approvazione di secondo livello' })
  }
  actors.push({
    id: 'hrbp',
    name: cards[0]?.hrbpName || 'HRBP',
    kind: 'hrbp',
    hint: 'Approvazione HRBP',
  })
  return actors
}

export function buildOrg(sourcePeople, settings = defaultSettings(), options = {}) {
  const usingDemo = !sourcePeople?.length
  const usingImport = !!options.imported && !usingDemo
  const base = (usingDemo ? demoPeople(options.today || new Date()) : sourcePeople).map((person) =>
    withPersonMeta(person, options.evaluationScores),
  )
  const people = annotatePeople(base, settings)
  const linked = people.some((p) => p.managerId)
  let cards
  if (usingDemo || linked) cards = hierarchyCards(people, usingDemo)
  else {
    const teams = teamBuckets(people)
    cards = teams.map((team, index) => ({
      id: `mgr-${index + 1}`,
      name: `Responsabile ${team.label}`,
      role: 'Manager',
      team: team.label,
      parentId: 'direzione',
      parentName: 'Direzione',
      hrbpId: 'hrbp',
      hrbpName: 'HRBP',
      reports: team.members,
    }))
  }
  const activeBand = people.find((p) => p.bandSource && p.bandSource !== 'none')?.bandSource || 'none'
  return {
    usingDemo,
    usingImport,
    signature: signatureOf(people, usingDemo),
    people,
    cards,
    actors: actorsFor(cards),
    bandSource: activeBand,
    sourceNote: usingImport
      ? 'Gerarchia importata nel ciclo. I responsabili sono i dipendenti indicati come id responsabile.'
      : usingDemo
        ? 'Organico di esempio: Elena Marini è responsabile di Luca Ferri, Giulia Conti e Marco De Santis, e ciascuno ha il proprio team.'
        : linked
          ? 'Gerarchia letta dal campo responsabile dell’analisi.'
          : 'Perimetri ricavati dai centri di costo dell’analisi. Il file non contiene la gerarchia: puoi importarla da CSV o Excel.',
  }
}

export function payrollOf(list) {
  return (list || []).reduce((sum, person) => sum + (Number(person.ral) || 0), 0)
}

export function cyclePool(settings, people) {
  const payroll = payrollOf(people)
  const amount =
    settings.poolMode === 'absolute'
      ? Math.max(0, Number(settings.poolAbsolute) || 0)
      : (payroll * (Number(settings.poolPercent) || 0)) / 100
  return { payroll, amount }
}

export function cascadePercent(settings, payroll, pool) {
  if (settings.poolMode === 'percent' && (settings.allocationMode || 'percent') === 'percent') {
    return Number(settings.poolPercent) || 0
  }
  if (payroll <= 0) return 0
  return (pool / payroll) * 100
}

function weightFactor(bucket, settings) {
  if (settings.allocationMode === 'weighted' && settings.weightBasis === 'performance') {
    if (bucket.performance == null) return 1
    return Math.max(0.25, Number(bucket.performance) / 100)
  }
  if (settings.allocationMode === 'weighted') {
    if (bucket.compa == null || bucket.compa <= 0) return 1
    return Math.max(0.25, 100 / Number(bucket.compa))
  }
  return 1
}

function bucketStats(list) {
  const compas = (list || []).map((p) => p.compa).filter((n) => n != null && Number.isFinite(n))
  const perfs = (list || []).map((p) => p.performance).filter((n) => n != null && Number.isFinite(Number(n)))
  return {
    payroll: payrollOf(list),
    compa: compas.length ? compas.reduce((a, b) => a + b, 0) / compas.length : null,
    performance: perfs.length ? perfs.reduce((a, b) => a + Number(b), 0) / perfs.length : null,
    count: (list || []).length,
  }
}

function allocateShares(buckets, budget) {
  const total = Math.max(0, Math.round(Number(budget) || 0))
  const result = {}
  if (!buckets.length) return result
  if (total <= 0) {
    for (const bucket of buckets) result[bucket.id] = 0
    return result
  }
  const weights = buckets.map((bucket) => Math.max(0, bucket.weight))
  const sum = weights.reduce((a, b) => a + b, 0)
  const raw = sum > 0 ? weights.map((w) => (total * w) / sum) : buckets.map(() => total / buckets.length)
  const amounts = raw.map((n) => Math.floor(n))
  let left = total - amounts.reduce((a, b) => a + b, 0)
  const order = raw
    .map((n, index) => ({ index, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac)
  for (let i = 0; i < left; i += 1) amounts[order[i % order.length].index] += 1
  buckets.forEach((bucket, index) => {
    result[bucket.id] = amounts[index]
  })
  return result
}

function shareBuckets(buckets, budget, settings) {
  return allocateShares(
    buckets.map((bucket) => ({
      id: bucket.id,
      weight: Math.max(0, bucket.payroll) * weightFactor(bucket, settings),
    })),
    budget,
  )
}

function childrenOf(cards, id) {
  return cards.filter((card) => card.parentId === id).sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

function subtreePeople(card, cards) {
  const out = [...card.reports]
  for (const child of childrenOf(cards, card.id)) out.push(...subtreePeople(child, cards))
  return out
}

function rootsOf(cards) {
  const ids = new Set(cards.map((c) => c.id))
  return cards
    .filter((card) => !card.parentId || !ids.has(card.parentId))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
}

function storedChild(distributions, parentId, childId) {
  const node = distributions?.[parentId]
  if (!node || node.children?.[childId] == null) return null
  return Math.max(0, Math.round(Number(node.children[childId]) || 0))
}

function storedRetained(distributions, parentId) {
  const node = distributions?.[parentId]
  if (!node || node.retained == null) return null
  return Math.max(0, Math.round(Number(node.retained) || 0))
}

function applyManuals(buckets, budget, settings, manualOf) {
  const pure = shareBuckets(buckets, budget, settings)
  const manuals = {}
  let manualSum = 0
  for (const bucket of buckets) {
    const value = manualOf(bucket.id)
    if (value != null) {
      manuals[bucket.id] = value
      manualSum += value
    }
  }
  const over = manualSum > budget + 0.5
  if (over && manualSum > 0) {
    const ids = Object.keys(manuals)
    let used = 0
    ids.forEach((id, index) => {
      if (index === ids.length - 1) return
      const next = Math.floor((manuals[id] * budget) / manualSum)
      manuals[id] = next
      used += next
    })
    manuals[ids[ids.length - 1]] = Math.max(0, budget - used)
    manualSum = budget
  }
  const autos = buckets.filter((bucket) => manuals[bucket.id] == null)
  const autoShares = shareBuckets(autos, Math.max(0, budget - manualSum), settings)
  const effective = {}
  for (const bucket of buckets) {
    effective[bucket.id] = manuals[bucket.id] != null ? manuals[bucket.id] : autoShares[bucket.id] || 0
  }
  return { pure, effective, over }
}

/**
 * Piano di allocazione. In cascata piatta ogni scheda riceve la sua quota dal pool.
 * In cascata gerarchica il pool va ai responsabili di primo livello, che lo dividono.
 */
export function planAllocation({ cards, people, settings, overrides, distributions }) {
  const list = cards || []
  const pool = Math.round(cyclePool(settings, people).amount)
  const hierarchy = settings?.cascadeMode === 'hierarchy'
  const rows = []
  const proposalBudget = {}

  const pushNode = (card, depth, envelope, methodAmount, manual) => {
    const children = childrenOf(list, card.id)
    const hasChildren = children.length > 0
    const direct = bucketStats(card.reports)
    let retained = envelope
    let retainedMethod = methodAmount
    let residual = null
    let splitOver = false
    if (hierarchy && hasChildren) {
      const scopeStats = bucketStats(subtreePeople(card, list))
      const buckets = [
        { id: '__retained', ...bucketStats(card.reports) },
        ...children.map((child) => ({ id: child.id, ...bucketStats(subtreePeople(child, list)) })),
      ]
      const split = applyManuals(buckets, envelope, settings, (id) =>
        id === '__retained' ? storedRetained(distributions, card.id) : storedChild(distributions, card.id, id),
      )
      retained = split.effective.__retained || 0
      retainedMethod = split.pure.__retained || 0
      residual = envelope - Object.values(split.effective).reduce((a, b) => a + b, 0)
      splitOver = split.over
      const childRows = children.map((child) => ({
        child,
        budget: split.effective[child.id] || 0,
        methodAmount: split.pure[child.id] || 0,
        manual: storedChild(distributions, card.id, child.id) != null,
      }))
      rows.push({
        key: card.id,
        kind: 'node',
        card,
        depth,
        hasChildren,
        directCount: direct.count,
        scopeCount: scopeStats.count,
        scopePayroll: scopeStats.payroll,
        budget: envelope,
        methodAmount,
        manual,
        pct: scopeStats.payroll > 0 ? (envelope / scopeStats.payroll) * 100 : 0,
        proposalBudget: retained,
        residual,
        splitOver,
        retained,
        retainedMethod,
        retainedManual: storedRetained(distributions, card.id) != null,
      })
      rows.push({
        key: `${card.id}::retained`,
        kind: 'retained',
        card,
        depth: depth + 1,
        hasChildren: false,
        directCount: direct.count,
        scopeCount: direct.count,
        scopePayroll: direct.payroll,
        budget: retained,
        methodAmount: retainedMethod,
        manual: storedRetained(distributions, card.id) != null,
        pct: direct.payroll > 0 ? (retained / direct.payroll) * 100 : 0,
        proposalBudget: retained,
        residual: null,
        label: 'Quota per le persone dirette',
      })
      for (const child of childRows) {
        pushNode(child.child, depth + 1, child.budget, child.methodAmount, child.manual)
      }
      proposalBudget[card.id] = retained
      return
    }
    const leafScope = hierarchy && depth === 0 ? bucketStats(subtreePeople(card, list)) : direct
    rows.push({
      key: card.id,
      kind: 'node',
      card,
      depth,
      hasChildren: false,
      directCount: direct.count,
      scopeCount: leafScope.count,
      scopePayroll: leafScope.payroll,
      budget: envelope,
      methodAmount,
      manual,
      pct: leafScope.payroll > 0 ? (envelope / leafScope.payroll) * 100 : 0,
      proposalBudget: envelope,
      residual: null,
    })
    proposalBudget[card.id] = envelope
  }

  if (!hierarchy) {
    const buckets = list.map((card) => ({ id: card.id, ...bucketStats(card.reports) }))
    const split = applyManuals(buckets, pool, settings, (id) => {
      const override = overrides?.[id]
      if (!override?.manual) return null
      return Math.max(0, Math.round(Number(override.amount) || 0))
    })
    for (const card of rootsOf(list)) {
      if (childrenOf(list, card.id).length) {
        pushFlatParent(card, depthOf(card, list), split, list, rows, proposalBudget, overrides)
      } else {
        pushNode(card, 0, split.effective[card.id] || 0, split.pure[card.id] || 0, !!overrides?.[card.id]?.manual)
      }
    }
  } else {
    const roots = rootsOf(list)
    const buckets = roots.map((card) => ({ id: card.id, ...bucketStats(subtreePeople(card, list)) }))
    const split = applyManuals(buckets, pool, settings, (id) => {
      const override = overrides?.[id]
      if (!override?.manual) return null
      return Math.max(0, Math.round(Number(override.amount) || 0))
    })
    for (const card of roots) {
      pushNode(card, 0, split.effective[card.id] || 0, split.pure[card.id] || 0, !!overrides?.[card.id]?.manual)
    }
  }

  return { pool, rows, proposalBudget, hierarchy }
}

function depthOf(card, cards) {
  let depth = 0
  let current = card
  const guard = new Set()
  while (current?.parentId && !guard.has(current.id)) {
    guard.add(current.id)
    const parent = cards.find((item) => item.id === current.parentId)
    if (!parent) break
    depth += 1
    current = parent
  }
  return depth
}

function pushFlatParent(card, depth, split, cards, rows, proposalBudget, overrides) {
  const envelope = split.effective[card.id] || 0
  const methodAmount = split.pure[card.id] || 0
  const direct = bucketStats(card.reports)
  rows.push({
    key: card.id,
    kind: 'node',
    card,
    depth,
    hasChildren: true,
    directCount: direct.count,
    scopeCount: direct.count,
    scopePayroll: direct.payroll,
    budget: envelope,
    methodAmount,
    manual: !!overrides?.[card.id]?.manual,
    pct: direct.payroll > 0 ? (envelope / direct.payroll) * 100 : 0,
    proposalBudget: envelope,
    residual: null,
    flatParent: true,
  })
  proposalBudget[card.id] = envelope
  for (const child of childrenOf(cards, card.id)) {
    const childBudget = split.effective[child.id] || 0
    const childMethod = split.pure[child.id] || 0
    if (childrenOf(cards, child.id).length) {
      pushFlatParent(child, depth + 1, split, cards, rows, proposalBudget, overrides)
    } else {
      const stats = bucketStats(child.reports)
      rows.push({
        key: child.id,
        kind: 'node',
        card: child,
        depth: depth + 1,
        hasChildren: false,
        directCount: stats.count,
        scopeCount: stats.count,
        scopePayroll: stats.payroll,
        budget: childBudget,
        methodAmount: childMethod,
        manual: !!overrides?.[child.id]?.manual,
        pct: stats.payroll > 0 ? (childBudget / stats.payroll) * 100 : 0,
        proposalBudget: childBudget,
        residual: null,
      })
      proposalBudget[child.id] = childBudget
    }
  }
}

export function cascadedBudget(reportsPayroll, settings, payroll, pool) {
  if (payroll <= 0) return 0
  return pool * (reportsPayroll / payroll)
}

export function effectiveBudget(reportsPayroll, settings, override, payroll, pool) {
  if (override?.manual) {
    if (override.mode === 'absolute') return Math.max(0, Number(override.amount) || 0)
    return (reportsPayroll * (Number(override.percent) || 0)) / 100
  }
  return cascadedBudget(reportsPayroll, settings, payroll, pool)
}

export function maxManualAmount(budget, distributions, parentId, fieldId) {
  const node = distributions?.[parentId] || {}
  let others = 0
  if (fieldId !== '__retained' && node.retained != null) others += Math.round(Number(node.retained) || 0)
  for (const [id, amount] of Object.entries(node.children || {})) {
    if (id !== fieldId) others += Math.round(Number(amount) || 0)
  }
  return Math.max(0, Math.round(budget) - others)
}

export function splitLevers(budget, settings) {
  if (settings.budgetMode !== 'perLever') {
    return { merit: budget, oneoff: budget, promotion: budget, unified: budget }
  }
  const merit = Number(settings.leverSplit?.merit) || 0
  const oneoff = Number(settings.leverSplit?.oneoff) || 0
  const promotion = Number(settings.leverSplit?.promotion) || 0
  const sum = merit + oneoff + promotion
  if (sum <= 0) return { merit: 0, oneoff: 0, promotion: 0, unified: budget }
  return {
    merit: (budget * merit) / sum,
    oneoff: (budget * oneoff) / sum,
    promotion: (budget * promotion) / sum,
    unified: budget,
  }
}

export function rulesFor(settings, managerRules, cardId) {
  const own = managerRules?.[cardId] || {}
  const ownership = { ...defaultRuleOwnership(), ...(settings?.ruleOwnership || {}) }
  const enabled = { ...defaultEnabledLevers(), ...(settings?.enabledLevers || {}) }
  const levers = ownership.levers === 'hr' ? { ...enabled } : { ...enabled, ...(own.levers || {}) }
  if (!LEVERS.some((lever) => levers[lever.id] !== false)) levers.merit = true
  const personCapPct =
    ownership.personCap === 'hr'
      ? Number(settings.personCapPct) || 0
      : Number(own.personCapPct ?? settings.personCapPct) || 0
  const aboveBandPolicy =
    ownership.aboveBand === 'hr' ? settings.aboveBandPolicy : own.aboveBandPolicy || settings.aboveBandPolicy
  const matrix = settings.matrix || defaultMatrix()
  const matrixEnabled = ownership.matrix === 'hr' ? matrix.enabled !== false : own.matrixEnabled ?? matrix.enabled !== false
  const matrixMode = ownership.matrix === 'hr' ? matrix.mode || 'indicative' : own.matrixMode || matrix.mode || 'indicative'
  return { ownership, levers, personCapPct, aboveBandPolicy, matrixEnabled, matrixMode }
}

export function personEligibility(person, settings, rules) {
  const flags = []
  const months = monthsBetween(person.hireDate, settings.referenceDate)
  const minMonths = Number(settings.newHireMonths) || 0
  if (months != null && months < minMonths) {
    flags.push({
      code: 'new_hire',
      blocking: true,
      label: `Neoassunto (${months} mesi, soglia ${minMonths})`,
    })
  }
  const threshold = Number(settings.aboveBandCompa) || 110
  const policy = rules?.aboveBandPolicy || settings.aboveBandPolicy
  if (person.compa != null && person.compa > threshold) {
    const blocking = policy === 'block'
    flags.push({
      code: 'above_band',
      blocking,
      label: `Compa-ratio ${Math.round(person.compa)}% sopra la soglia ${threshold}%`,
    })
  }
  return { blocking: flags.some((f) => f.blocking), flags }
}

export function bandColumn(position) {
  if (position == null || !Number.isFinite(position)) return 'low'
  if (position < 0) return 'below'
  if (position < 0.5) return 'low'
  if (position <= 1) return 'high'
  return 'above'
}

export function performanceBand(score, matrix = defaultMatrix()) {
  if (score == null || !Number.isFinite(Number(score))) return null
  const value = Number(score)
  return (matrix.rows || []).find((row) => value >= row.min && value <= row.max) || null
}

export function recommendedPct(person, settings) {
  const matrix = settings?.matrix || defaultMatrix()
  const column = bandColumn(person?.position)
  if (person?.performance == null) return Number(matrix.noPerf?.[column]) || 0
  const row = performanceBand(person.performance, matrix)
  if (!row) return Number(matrix.noPerf?.[column]) || 0
  return Number(matrix.cells?.[row.id]?.[column]) || 0
}

export function proposalOf(proposals, personId) {
  const raw = proposals?.[personId] || {}
  const lever = LEVERS.some((l) => l.id === raw.lever) ? raw.lever : 'merit'
  return {
    lever,
    amount: Math.max(0, Math.round(Number(raw.amount) || 0)),
    newLevel: raw.newLevel ? String(raw.newLevel) : '',
    motivation: raw.motivation ? String(raw.motivation) : '',
    motivationNote: raw.motivationNote ? String(raw.motivationNote) : '',
  }
}

export function countedAmount(person, proposal, settings, rules) {
  if (personEligibility(person, settings, rules).blocking) return 0
  if (rules && rules.levers?.[proposal.lever] === false) return 0
  return proposal.amount
}

export function spentByLever(reports, proposals, settings, rules) {
  const totals = { merit: 0, oneoff: 0, promotion: 0, all: 0 }
  for (const person of reports || []) {
    const proposal = proposalOf(proposals, person.id)
    const amount = countedAmount(person, proposal, settings, rules)
    totals[proposal.lever] += amount
    totals.all += amount
  }
  return totals
}

function hourlyPay(person, ral) {
  const pt = Number(person?.partTimePct)
  const ratio = Number.isFinite(pt) && pt > 0 ? Math.min(pt, 100) / 100 : 1
  const hours = DEFAULT_ANNUAL_HOURS * ratio
  return hours > 0 ? ral / hours : 0
}

export function gapOf(people, ralOf) {
  const men = []
  const women = []
  for (const person of people || []) {
    const ral = ralOf(person)
    if (!(ral > 0)) continue
    const hourly = hourlyPay(person, ral)
    if (person.gender === 'M') men.push(hourly)
    else if (person.gender === 'F') women.push(hourly)
  }
  const gap = men.length && women.length ? genderPayGapPct(avg(men), avg(women)) : null
  return {
    gap,
    nM: men.length,
    nF: women.length,
    sufficient: gapSampleSufficient(men.length, women.length, MIN_GENDER_SAMPLE),
  }
}

function avg(list) {
  if (!list.length) return null
  return list.reduce((sum, n) => sum + n, 0) / list.length
}

export function ralAfter(person, proposal, settings, rules) {
  if (personEligibility(person, settings, rules).blocking) return person.ral
  if (rules && rules.levers?.[proposal.lever] === false) return person.ral
  return newRal(person, proposal)
}

function isOutOfBand(person, ral) {
  if (person?.bandMin == null || person?.bandMax == null) return false
  return ral < person.bandMin - 0.5 || ral > person.bandMax + 0.5
}

export function transparencyOf(reports, proposals, settings, rules) {
  const ralNow = (person) => person.ral
  const ralNext = (person) => ralAfter(person, proposalOf(proposals, person.id), settings, rules)
  const before = gapOf(reports, ralNow)
  const after = gapOf(reports, ralNext)
  const levels = [...new Set(reports.map((p) => p.level || 'N/D'))]
  const byLevel = levels.map((level) => {
    const group = reports.filter((p) => (p.level || 'N/D') === level)
    return {
      level,
      before: gapOf(group, ralNow),
      after: gapOf(group, ralNext),
    }
  })
  return {
    before,
    after,
    byLevel,
    outOfBand: {
      before: reports.filter((p) => isOutOfBand(p, p.ral)).length,
      after: reports.filter((p) => isOutOfBand(p, ralNext(p))).length,
    },
  }
}

function rowAlerts(person, proposal, reports, proposals, settings, rules) {
  const alerts = []
  const amount = countedAmount(person, proposal, settings, rules)
  if (amount <= 0 || proposal.lever === 'oneoff') return alerts
  const next = ralAfter(person, proposal, settings, rules)
  if (person.bandMax != null && next > person.bandMax + 0.5) {
    alerts.push('L’aumento porta la RAL sopra il massimo di banda')
  }
  const level = person.level || 'N/D'
  const group = (reports || []).filter((item) => (item.level || 'N/D') === level)
  const without = { ...proposals, [person.id]: { ...proposal, amount: 0 } }
  const gapWith = gapOf(group, (item) => ralAfter(item, proposalOf(proposals, item.id), settings, rules)).gap
  const gapWithout = gapOf(group, (item) => ralAfter(item, proposalOf(without, item.id), settings, rules)).gap
  const threshold = Number(settings.gapAlertPct) || 5
  if (gapWith != null && gapWithout != null && Math.abs(gapWith) > Math.abs(gapWithout) + 0.05 && Math.abs(gapWith) > threshold) {
    alerts.push(`L’aumento allarga il gap di genere del livello ${level} oltre il ${formatPct(threshold, 0)}`)
  }
  return alerts
}

export function evaluateCard({ card, proposals, settings, budget, managerRules }) {
  const rules = rulesFor(settings, managerRules, card.id)
  const levers = splitLevers(budget, settings)
  const spent = spentByLever(card.reports, proposals, settings, rules)
  const perLever = settings.budgetMode === 'perLever'
  const matrix = settings.matrix || defaultMatrix()
  const tolerance = Number(matrix.tolerancePct) || 0
  const rows = card.reports.map((person) => {
    const proposal = proposalOf(proposals, person.id)
    const elig = personEligibility(person, settings, rules)
    const cap = (person.ral * (Number(rules.personCapPct) || 0)) / 100
    const leverAllowed = rules.levers[proposal.lever] !== false
    const pct = recommendedPct(person, settings)
    const matrixAmount = Math.round((person.ral * pct) / 100)
    const proposedPct = person.ral > 0 ? (proposal.amount / person.ral) * 100 : 0
    const deviationPct = proposal.lever === 'oneoff' || proposal.amount <= 0 ? 0 : Math.abs(proposedPct - pct)
    const matrixOn = rules.matrixEnabled && proposal.lever !== 'oneoff' && proposal.amount > 0 && !elig.blocking && leverAllowed
    const needsMotivation = matrixOn && deviationPct > tolerance + 0.001
    const alerts = elig.blocking ? [] : rowAlerts(person, proposal, card.reports, proposals, settings, rules)
    return {
      person,
      proposal,
      elig,
      cap,
      leverAllowed,
      matrixPct: pct,
      matrixAmount,
      proposedPct,
      deviationPct,
      needsMotivation,
      alerts,
      performanceBand: performanceBand(person.performance, matrix),
    }
  })
  const overByLever = {
    merit: spent.merit > levers.merit + 0.5,
    oneoff: spent.oneoff > levers.oneoff + 0.5,
    promotion: spent.promotion > levers.promotion + 0.5,
    all: spent.all > budget + 0.5,
  }
  const overBudget = perLever ? overByLever.merit || overByLever.oneoff || overByLever.promotion : overByLever.all
  const residual = perLever
    ? {
        all: budget - spent.all,
        merit: levers.merit - spent.merit,
        oneoff: levers.oneoff - spent.oneoff,
        promotion: levers.promotion - spent.promotion,
      }
    : { all: budget - spent.all, merit: budget - spent.all, oneoff: budget - spent.all, promotion: budget - spent.all }
  const transparency = transparencyOf(card.reports, proposals, settings, rules)
  const exceptions = rows.filter((row) => row.needsMotivation).length
  return { budget, levers, spent, residual, overBudget, overByLever, rows, perLever, rules, transparency, exceptions }
}

export function nextAmount({ card, proposals, settings, budget, personId, rawAmount, managerRules }) {
  const rules = rulesFor(settings, managerRules, card.id)
  const person = card.reports.find((p) => p.id === personId)
  if (!person) return { amount: 0, flags: { capped: false, blockedByBudget: false, matrixBlocked: false } }
  if (personEligibility(person, settings, rules).blocking) {
    return { amount: 0, flags: { capped: false, blockedByBudget: false, matrixBlocked: false } }
  }
  const prev = proposalOf(proposals, personId)
  if (rules.levers[prev.lever] === false) {
    return { amount: 0, flags: { capped: false, blockedByBudget: false, matrixBlocked: false } }
  }
  const current = evaluateCard({ card, proposals, settings, budget, managerRules })
  const leverBudget = settings.budgetMode === 'perLever' ? current.levers[prev.lever] : current.budget
  const spentLever = settings.budgetMode === 'perLever' ? current.spent[prev.lever] : current.spent.all
  const spentWithout = spentLever - countedAmount(person, prev, settings, rules)
  let amount = Math.max(0, Math.round(parseEuroInput(rawAmount)))
  const flags = { capped: false, blockedByBudget: false, matrixBlocked: false }
  const cap = (person.ral * (Number(rules.personCapPct) || 0)) / 100
  if (amount > cap + 0.001) {
    amount = Math.max(0, Math.round(cap))
    flags.capped = true
  }
  if (rules.matrixEnabled && rules.matrixMode === 'binding' && prev.lever !== 'oneoff') {
    const ceiling = Math.round((person.ral * (recommendedPct(person, settings) + (Number(settings.matrix?.tolerancePct) || 0))) / 100)
    if (amount > ceiling) {
      amount = Math.max(0, ceiling)
      flags.matrixBlocked = true
    }
  }
  const room = leverBudget - spentWithout
  if (amount > room + 0.5 && settings.overBudget === 'block') {
    amount = Math.max(0, Math.round(room))
    flags.blockedByBudget = true
  }
  return { amount, flags }
}

export function newRal(person, proposal) {
  if (!proposal || proposal.lever === 'oneoff') return person.ral
  return person.ral + (proposal.amount || 0)
}

export function submitBlockers(evaluation, settings) {
  const reasons = []
  const order = dateOrderError(settings)
  if (order) reasons.push(order)
  if (evaluation.spent.all <= 0) reasons.push('Inserisci almeno una proposta con importo.')
  const missingLevel = evaluation.rows.some(
    (row) =>
      row.proposal.lever === 'promotion' &&
      countedAmount(row.person, row.proposal, settings, evaluation.rules) > 0 &&
      !row.proposal.newLevel.trim(),
  )
  if (missingLevel) reasons.push('Per ogni promozione indica il nuovo livello.')
  const missingMotivation = evaluation.rows.filter(
    (row) => row.needsMotivation && (!row.proposal.motivation || (row.proposal.motivation === 'other' && !row.proposal.motivationNote.trim())),
  )
  if (missingMotivation.length) {
    reasons.push(`Motivazione obbligatoria per ${missingMotivation.map((row) => row.person.name).join(', ')}.`)
  }
  if (evaluation.overBudget && settings.overBudget === 'block') reasons.push('Il budget del manager è superato.')
  return reasons
}

export function submitStatus(settings, card) {
  if (settings.secondApprover === 'hrbp') return 'pending_hrbp'
  if (settings.secondApprover === 'manager' && card.parentId) return 'pending_l2'
  return 'pending_hr'
}

export function approveStatus(status) {
  if (status === 'pending_l2' || status === 'pending_hrbp') return 'pending_hr'
  if (status === 'pending_hr') return 'approved'
  return status
}

export function canEdit(actorId, card, status) {
  if (status === 'approved' || status === 'pending_l2' || status === 'pending_hrbp') return false
  if (status === 'pending_hr') return actorId === 'hr'
  if (status === 'draft' || status === 'rejected') return actorId === card.id || actorId === 'hr'
  return false
}

export function canSubmit(actorId, card, status) {
  if (status !== 'draft' && status !== 'rejected') return false
  return actorId === card.id || actorId === 'hr'
}

export function canApprove(actorId, card, status) {
  if (status === 'pending_hr' && actorId === 'hr') return true
  if (status === 'pending_hrbp' && actorId === 'hrbp') return true
  if (status === 'pending_l2' && actorId === card.parentId) return true
  return false
}

export function canReject(actorId, card, status) {
  if (status !== 'pending_l2' && status !== 'pending_hrbp' && status !== 'pending_hr') return false
  if (actorId === 'hr') return true
  return canApprove(actorId, card, status)
}

export function canReturn(actorId, status) {
  return actorId === 'hr' && (status === 'pending_hr' || status === 'pending_l2' || status === 'pending_hrbp' || status === 'approved')
}

export function consumedBudget(budget, spent, status, unusedPolicy) {
  const open = status === 'draft' || status === 'rejected' || status === 'pending_l2' || status === 'pending_hrbp' || status === 'pending_hr'
  if (open || status !== 'approved') return budget
  if (unusedPolicy === 'forfeit') return budget
  return spent
}

export function letterRows({ cards, proposals, packages, settings, names, managerRules }) {
  const rows = []
  for (const card of cards) {
    const pkg = packages?.[card.id]
    if (pkg?.status !== 'approved') continue
    const rules = rulesFor(settings, managerRules, card.id)
    const managerName = names?.[card.id]?.trim() || card.name
    for (const person of card.reports) {
      const proposal = proposalOf(proposals, person.id)
      const amount = countedAmount(person, proposal, settings, rules)
      if (amount <= 0) continue
      rows.push({ ...letterFrom(person, proposal, amount, managerName, settings), cardId: card.id })
    }
  }
  return rows
}

function letterFrom(person, proposal, amount, managerName, settings) {
  const applied = { ...proposal, amount }
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    level: person.level,
    newLevel: proposal.lever === 'promotion' ? proposal.newLevel : person.level,
    lever: proposal.lever,
    leverLabel: leverLabel(proposal.lever),
    ral: person.ral,
    amount,
    newRal: newRal(person, applied),
    oneOff: proposal.lever === 'oneoff' ? amount : 0,
    merit: proposal.lever === 'merit' ? amount : 0,
    promotion: proposal.lever === 'promotion' ? amount : 0,
    managerName,
    status: 'Approvato',
    motivation: proposal.motivation,
    motivationLabel: motivationLabel(proposal.motivation),
    motivationNote: proposal.motivationNote,
    matrixPct: recommendedPct(person, settings),
    gender: person.gender,
    performance: person.performance,
  }
}

export function criteriaRows({ cards, proposals, settings, names, managerRules }) {
  const rows = []
  for (const card of cards || []) {
    const rules = rulesFor(settings, managerRules, card.id)
    const managerName = names?.[card.id]?.trim() || card.name
    for (const person of card.reports || []) {
      const proposal = proposalOf(proposals, person.id)
      const amount = countedAmount(person, proposal, settings, rules)
      if (amount <= 0) continue
      const proposedPct = person.ral > 0 ? (amount / person.ral) * 100 : 0
      const matrixPct = proposal.lever === 'oneoff' ? null : recommendedPct(person, settings)
      rows.push({
        ...letterFrom(person, proposal, amount, managerName, settings),
        cardId: card.id,
        status: 'Proposta',
        proposedPct,
        matrixPct,
        deviationPct: matrixPct == null ? null : Math.abs(proposedPct - matrixPct),
      })
    }
  }
  return rows
}

export function payrollCsv(rows, effectiveDate) {
  const headers = [
    'Matricola',
    'Nome',
    'Ruolo',
    'Livello attuale',
    'Nuovo livello',
    'Leva',
    'RAL attuale',
    'Aumento merito',
    'Promozione',
    'Una tantum',
    'Nuova RAL',
    'Data efficacia',
    'Stato',
    'Manager',
    'Motivazione',
    'Nota motivazione',
  ]
  const lines = [headers.join(';')]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.name,
        row.role,
        row.level,
        row.newLevel,
        row.leverLabel,
        euroCell(row.ral),
        euroCell(row.merit),
        euroCell(row.promotion),
        euroCell(row.oneOff),
        euroCell(row.newRal),
        effectiveDate || '',
        row.status,
        row.managerName,
        row.motivationLabel || '',
        row.motivationNote || '',
      ]
        .map(csvCell)
        .join(';'),
    )
  }
  return `\uFEFF${lines.join('\r\n')}`
}

export function criteriaCsv(rows, effectiveDate) {
  const headers = [
    'Matricola',
    'Nome',
    'Manager',
    'Leva',
    'RAL',
    'Importo',
    'Percentuale proposta',
    'Percentuale matrice',
    'Scostamento punti',
    'Motivazione',
    'Nota',
    'Data efficacia',
  ]
  const lines = [headers.join(';')]
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.name,
        row.managerName,
        row.leverLabel,
        euroCell(row.ral),
        euroCell(row.amount),
        row.proposedPct == null ? '' : String(row.proposedPct.toFixed(2)).replace('.', ','),
        row.matrixPct == null ? '' : String(Number(row.matrixPct).toFixed(2)).replace('.', ','),
        row.deviationPct == null ? '' : String(row.deviationPct.toFixed(2)).replace('.', ','),
        row.motivationLabel || '',
        row.motivationNote || '',
        effectiveDate || '',
      ]
        .map(csvCell)
        .join(';'),
    )
  }
  return `\uFEFF${lines.join('\r\n')}`
}

export function hierarchyTemplateCsv() {
  const headers = [
    'id dipendente',
    'nome',
    'ruolo',
    'RAL',
    'livello CCNL',
    'job family',
    'id responsabile',
    'data assunzione',
    'genere',
    'performance',
  ]
  const sample = [
    ['elena', 'Elena Marini', 'Direttrice People & Reward', '90000', 'Q', 'People', '', '2012-01-15', 'F', '90'],
    ['luca', 'Luca Ferri', 'Sales Manager', '72000', 'Q', 'Sales', 'elena', '2014-02-01', 'M', '86'],
    ['irene', 'Irene Fontana', 'Product Designer', '32000', 'C2', 'Product', 'giulia', '2021-11-01', 'F', ''],
  ]
  return `\uFEFF${[headers.join(';'), ...sample.map((row) => row.join(';'))].join('\r\n')}`
}

const HEADER_ALIASES = {
  id: ['id dipendente', 'id', 'matricola', 'employee id', 'employeeid'],
  name: ['nome', 'name', 'dipendente'],
  role: ['ruolo', 'role', 'job title', 'jobtitle'],
  ral: ['ral', 'retribuzione', 'retribuzione annua', 'salary'],
  level: ['livello ccnl', 'livello', 'level'],
  jobFamily: ['job family', 'jobfamily', 'famiglia', 'famiglia professionale'],
  managerId: ['id responsabile', 'responsabile', 'manager id', 'managerid', 'id manager'],
  hireDate: ['data assunzione', 'assunzione', 'hire date', 'hiredate', 'data ingresso'],
  gender: ['genere', 'gender', 'sesso'],
  performance: ['performance', 'valutazione', 'performance score'],
}

function normHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function rowsToPeople(rows) {
  if (!Array.isArray(rows) || !rows.length) return { people: [], errors: ['Il file non contiene righe.'] }
  const headers = Object.keys(rows[0] || {})
  const map = {}
  for (const key of Object.keys(HEADER_ALIASES)) {
    const found = headers.find((header) => HEADER_ALIASES[key].includes(normHeader(header)))
    if (found) map[key] = found
  }
  const missing = ['id', 'name', 'ral', 'managerId'].filter((key) => !map[key])
  if (missing.length) {
    return {
      people: [],
      errors: ['Servono almeno le colonne id dipendente, nome, RAL e id responsabile.'],
    }
  }
  const people = []
  const errors = []
  const seen = new Set()
  rows.forEach((row, index) => {
    const id = String(row[map.id] ?? '').trim()
    const name = String(row[map.name] ?? '').trim()
    const ral = parseEuroInput(row[map.ral])
    if (!id && !name && !ral) return
    if (!id || !name || !(ral > 0)) {
      errors.push(`Riga ${index + 2}: servono id, nome e RAL positiva.`)
      return
    }
    if (seen.has(id)) {
      errors.push(`Riga ${index + 2}: id ${id} duplicato.`)
      return
    }
    seen.add(id)
    const performanceRaw = map.performance ? row[map.performance] : ''
    const performance = performanceRaw === '' || performanceRaw == null ? null : Number(String(performanceRaw).replace(',', '.'))
    people.push({
      id,
      name,
      role: map.role ? String(row[map.role] || '').trim() || 'Ruolo non indicato' : 'Ruolo non indicato',
      ral,
      level: map.level ? String(row[map.level] || '').trim() || 'N/D' : 'N/D',
      jobFamily: map.jobFamily ? String(row[map.jobFamily] || '').trim() || 'Non assegnata' : 'Non assegnata',
      category: map.jobFamily ? String(row[map.jobFamily] || '').trim() || 'Non assegnata' : 'Non assegnata',
      managerId: String(row[map.managerId] ?? '').trim() || null,
      hireDate: map.hireDate ? normalizeHireDate(row[map.hireDate]) : null,
      gender: map.gender ? normalizeGender(row[map.gender]) : null,
      performance: Number.isFinite(performance) ? performance : null,
      lastIncreasePct: null,
      lastIncreaseDate: null,
    })
  })
  if (!people.length && !errors.length) errors.push('Nessun dipendente importato.')
  return { people, errors }
}

export function calibrationOf({ cards, evaluations, proposals, settings, managerRules }) {
  const managers = (cards || []).map((card) => {
    const evaluation = evaluations?.[card.id]
    const payroll = payrollOf(card.reports)
    const proposed = evaluation?.spent.all || 0
    const increases = (evaluation?.rows || []).filter((row) => countedAmount(row.person, row.proposal, settings, evaluation.rules) > 0)
    const avgIncrease = increases.length
      ? increases.reduce((sum, row) => sum + (row.person.ral > 0 ? (countedAmount(row.person, row.proposal, settings, evaluation.rules) / row.person.ral) * 100 : 0), 0) /
        increases.length
      : 0
    return {
      card,
      budget: evaluation?.budget || 0,
      proposed,
      pct: payroll > 0 ? (proposed / payroll) * 100 : 0,
      avgIncrease,
      exceptions: evaluation?.exceptions || 0,
      alerts: (evaluation?.rows || []).filter((row) => row.alerts.length || row.needsMotivation).length,
    }
  })
  const peopleRows = []
  for (const card of cards || []) {
    const evaluation = evaluations?.[card.id]
    for (const row of evaluation?.rows || []) {
      const amount = countedAmount(row.person, row.proposal, settings, evaluation.rules)
      if (amount <= 0) continue
      peopleRows.push({ ...row, amount, card })
    }
  }
  const distribute = (list, keyOf) => {
    const groups = new Map()
    for (const row of list) {
      const key = keyOf(row)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    return [...groups.entries()]
      .map(([label, items]) => ({
        label,
        n: items.length,
        amount: items.reduce((sum, row) => sum + row.amount, 0),
        avg: items.reduce((sum, row) => sum + (row.person.ral > 0 ? (row.amount / row.person.ral) * 100 : 0), 0) / items.length,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'it'))
  }
  const by = (list) => ({
    gender: distribute(list, (row) => (row.person.gender === 'M' ? 'Uomini' : row.person.gender === 'F' ? 'Donne' : 'Non indicato')),
    level: distribute(list, (row) => row.person.level || 'N/D'),
    performance: distribute(list, (row) => row.performanceBand?.label || (row.person.performance == null ? 'Senza valutazione' : 'Fuori fascia')),
  })
  return {
    managers,
    distribution: by(peopleRows),
    exceptionsOnly: by(peopleRows.filter((row) => row.needsMotivation || row.alerts.length)),
  }
}

function euroCell(n) {
  return (Number(n) || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function csvCell(value) {
  const s = String(value ?? '')
  if (/[;"\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function storageKey(signature) {
  return `salary-review-v2:${signature}`
}

export const IMPORT_STORAGE_KEY = 'salary-review-hierarchy'
