<script setup>
import { computed, ref, watch } from 'vue'
import * as XLSX from 'xlsx'
import {
  BAND_SOURCE_LABEL,
  IMPORT_STORAGE_KEY,
  LEVERS,
  MATRIX_COLUMNS,
  MOTIVATIONS,
  OWNERSHIP_OPTIONS,
  STATUS_LABEL,
  allocationFormula,
  approveStatus,
  bandRows,
  buildOrg,
  calibrationOf,
  canApprove,
  canEdit,
  canReject,
  canReturn,
  canSubmit,
  consumedBudget,
  criteriaCsv,
  criteriaRows,
  cyclePool,
  dateOrderError,
  defaultSettings,
  demoSeed,
  emptyPackage,
  evaluateCard,
  formatEuro,
  formatPct,
  hierarchyTemplateCsv,
  letterRows,
  mergeSettings,
  nextAmount,
  newRal,
  parseEuroInput,
  payrollCsv,
  planAllocation,
  proposalOf,
  rowsToPeople,
  rulesFor,
  storageKey,
  submitBlockers,
  submitStatus,
} from '../lib/salaryReview.js'

const props = defineProps({
  sourcePeople: { type: Array, default: () => [] },
  companyName: { type: String, default: '' },
  evaluationScores: { type: Object, default: () => ({}) },
})

function readImported() {
  try {
    const parsed = JSON.parse(localStorage.getItem(IMPORT_STORAGE_KEY) || 'null')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const importedPeople = ref(readImported())
const ready = ref(false)
const settings = ref(defaultSettings())
const overrides = ref({})
const distributions = ref({})
const managerRules = ref({})
const names = ref({})
const proposals = ref({})
const packages = ref({})
const actorId = ref('hr')
const tab = ref('budget')
const approvalView = ref('stato')
const exceptionsOnly = ref(false)
const openCards = ref({})
const expanded = ref({})
const rowHints = ref({})
const notices = ref({})
const rejectNotes = ref({})
const actionError = ref('')
const importError = ref('')

const peopleSource = computed(() => (importedPeople.value.length ? importedPeople.value : props.sourcePeople))
const org = computed(() =>
  buildOrg(peopleSource.value, settings.value, {
    imported: importedPeople.value.length > 0,
    evaluationScores: props.evaluationScores,
  }),
)
const actor = computed(() => org.value.actors.find((item) => item.id === actorId.value) || org.value.actors[0])
const seesCompany = computed(() => actor.value?.kind === 'hr' || actor.value?.kind === 'hrbp')
const isHr = computed(() => actor.value?.kind === 'hr')
const poolInfo = computed(() => cyclePool(settings.value, org.value.people))
const plan = computed(() =>
  planAllocation({
    cards: org.value.cards,
    people: org.value.people,
    settings: settings.value,
    overrides: overrides.value,
    distributions: distributions.value,
  }),
)
const dateError = computed(() => dateOrderError(settings.value))
const bands = computed(() => bandRows(org.value.people, settings.value))
const formula = computed(() => allocationFormula(settings.value))

const evaluations = computed(() => {
  const map = {}
  for (const card of org.value.cards) {
    map[card.id] = evaluateCard({
      card,
      proposals: proposals.value,
      settings: settings.value,
      budget: plan.value.proposalBudget[card.id] || 0,
      managerRules: managerRules.value,
    })
  }
  return map
})

const central = computed(() => {
  let reserved = 0
  let returned = 0
  let forfeited = 0
  let redistributable = 0
  let spentAll = 0
  for (const card of org.value.cards) {
    const budget = plan.value.proposalBudget[card.id] || 0
    const spent = evaluations.value[card.id]?.spent.all || 0
    const status = packages.value[card.id]?.status || 'draft'
    spentAll += spent
    reserved += consumedBudget(budget, spent, status, settings.value.unusedPolicy)
    if (status === 'approved') {
      const gap = Math.max(0, budget - spent)
      if (settings.value.unusedPolicy === 'return') returned += gap
      else if (settings.value.unusedPolicy === 'redistribute') redistributable += gap
      else forfeited += gap
    }
  }
  const allocated = Object.values(plan.value.proposalBudget).reduce((sum, value) => sum + value, 0)
  return {
    pool: plan.value.pool,
    allocated,
    reserved,
    residual: plan.value.pool - reserved,
    returned,
    forfeited,
    redistributable,
    spentAll,
    overAllocated: allocated > plan.value.pool + 1,
  }
})

function scopeCardIds() {
  const kind = actor.value?.kind
  if (kind === 'hr' || kind === 'hrbp') return null
  if (kind === 'approver') {
    return new Set(org.value.cards.filter((card) => card.parentId === actor.value.id).map((card) => card.id))
  }
  const ids = new Set()
  const walk = (id) => {
    if (!id || ids.has(id)) return
    ids.add(id)
    for (const card of org.value.cards) if (card.parentId === id) walk(card.id)
  }
  walk(actor.value?.id)
  return ids
}

function isExpanded(id) {
  if (Object.prototype.hasOwnProperty.call(expanded.value, id)) return !!expanded.value[id]
  return true
}

const treeRows = computed(() => {
  const ids = scopeCardIds()
  return plan.value.rows.filter((row) => {
    if (ids && !ids.has(row.card.id)) return false
    if (row.kind === 'retained') return isExpanded(row.card.id)
    let parentId = row.card.parentId
    const guard = new Set()
    while (parentId && !guard.has(parentId)) {
      guard.add(parentId)
      if (!isExpanded(parentId)) return false
      parentId = org.value.cards.find((card) => card.id === parentId)?.parentId
    }
    return true
  })
})

const schedeCards = computed(() => {
  const kind = actor.value?.kind
  if (kind === 'manager' || kind === 'director') return org.value.cards.filter((card) => card.id === actor.value.id)
  if (kind === 'approver') return []
  return org.value.cards
})

const inbox = computed(() =>
  org.value.cards
    .map((card) => ({
      card,
      pkg: packages.value[card.id] || emptyPackage(),
      evaluation: evaluations.value[card.id],
    }))
    .filter(({ card, pkg }) => {
      const id = actor.value?.id
      const kind = actor.value?.kind
      if (kind === 'hr') return true
      if (id === card.id) return true
      if (pkg.status === 'pending_l2' && card.parentId === id) return true
      if (kind === 'hrbp' && (pkg.status === 'pending_hrbp' || pkg.status === 'approved')) return true
      return false
    }),
)

const letters = computed(() => {
  const rows = letterRows({
    cards: org.value.cards,
    proposals: proposals.value,
    packages: packages.value,
    settings: settings.value,
    names: names.value,
    managerRules: managerRules.value,
  })
  const ids = scopeCardIds()
  return ids ? rows.filter((row) => ids.has(row.cardId)) : rows
})

const criteria = computed(() => {
  const rows = criteriaRows({
    cards: org.value.cards,
    proposals: proposals.value,
    settings: settings.value,
    names: names.value,
    managerRules: managerRules.value,
  })
  const ids = scopeCardIds()
  return ids ? rows.filter((row) => ids.has(row.cardId)) : rows
})

const calibration = computed(() =>
  calibrationOf({
    cards: org.value.cards,
    evaluations: evaluations.value,
    proposals: proposals.value,
    settings: settings.value,
    managerRules: managerRules.value,
  }),
)

const calibrationManagers = computed(() => {
  if (!exceptionsOnly.value) return calibration.value.managers
  return calibration.value.managers.filter((row) => row.exceptions > 0 || row.alerts > 0)
})

const calibrationDistribution = computed(() =>
  exceptionsOnly.value ? calibration.value.exceptionsOnly : calibration.value.distribution,
)

const levels = computed(() =>
  [...new Set(org.value.people.map((person) => person.level).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
)

const leverWeightSum = computed(() => {
  const split = settings.value.leverSplit || {}
  return (Number(split.merit) || 0) + (Number(split.oneoff) || 0) + (Number(split.promotion) || 0)
})

const pendingForActor = computed(() => inbox.value.filter(({ card, pkg }) => canApprove(actor.value?.id, card, pkg.status)).length)

const residualNote = computed(() => {
  if (settings.value.unusedPolicy === 'redistribute') return 'Il non speso approvato si può spostare tra i manager'
  if (settings.value.unusedPolicy === 'return') return 'Il non speso approvato rientra'
  return 'Il non speso approvato resta perso'
})

function displayName(card) {
  return names.value[card.id]?.trim() || card.name
}

function pkgOf(id) {
  return packages.value[id] || emptyPackage()
}

function cardRules(card) {
  return rulesFor(settings.value, managerRules.value, card.id)
}

function leverNames(card) {
  return LEVERS.filter((lever) => cardRules(card).levers[lever.id] !== false)
    .map((lever) => lever.label)
    .join(', ')
}

function leversFor(card) {
  const rules = cardRules(card)
  return LEVERS.filter((lever) => rules.levers[lever.id] !== false)
}

function canTweak(card, field) {
  if (cardRules(card).ownership[field] === 'hr') return false
  return canEdit(actorId.value, card, pkgOf(card.id).status)
}

function managerCanChoose(card) {
  return Object.values(cardRules(card).ownership).some((value) => value !== 'hr')
}

function nodeOf(cardId) {
  return plan.value.rows.find((row) => row.kind === 'node' && row.card.id === cardId)
}

function showRedistribute(card) {
  const node = nodeOf(card.id)
  if (settings.value.cascadeMode !== 'hierarchy' || !node?.hasChildren) return false
  return actor.value?.id === card.id || actor.value?.kind === 'hr'
}

function redistributeRows(card) {
  return plan.value.rows.filter(
    (row) => (row.kind === 'retained' && row.card.id === card.id) || (row.kind === 'node' && row.card.parentId === card.id),
  )
}

function isDistributionRow(row) {
  if (settings.value.cascadeMode !== 'hierarchy') return false
  if (row.kind === 'retained') return true
  return row.kind === 'node' && org.value.cards.some((card) => card.id === row.card.parentId)
}

function canEditAllocation(row) {
  const kind = actor.value?.kind
  if (kind === 'hr') return true
  if (kind !== 'director' || settings.value.cascadeMode !== 'hierarchy') return false
  if (row.kind === 'retained') return row.card.id === actor.value.id
  return row.kind === 'node' && row.card.parentId === actor.value.id
}

function peopleCount(row) {
  if (settings.value.cascadeMode === 'hierarchy' && row.hasChildren) {
    return `${row.directCount} diretti · ${row.scopeCount} nel perimetro`
  }
  return String(row.directCount)
}

function varianceText(row) {
  const delta = row.budget - row.methodAmount
  if (Math.abs(delta) < 1) return 'In linea'
  return formatEuro(delta)
}

function varianceClass(row) {
  const delta = row.budget - row.methodAmount
  if (delta > 1) return 'is-neg'
  if (delta < -1) return 'is-ok'
  return ''
}

function gapText(stat) {
  if (!stat || stat.gap == null) return 'n/d'
  const sample = stat.sufficient ? '' : ' · campione ridotto'
  return `${formatPct(stat.gap)}${sample}`
}

function hydrate(signature) {
  ready.value = false
  let stored = null
  try {
    stored = JSON.parse(localStorage.getItem(storageKey(signature)) || 'null')
  } catch {
    stored = null
  }
  const base = defaultSettings()
  let nextSettings = stored?.settings ? mergeSettings(base, stored.settings) : base
  let nextRules = stored?.managerRules && typeof stored.managerRules === 'object' ? stored.managerRules : {}
  let nextProposals = stored?.proposals && typeof stored.proposals === 'object' ? stored.proposals : {}
  if (!stored && signature === 'demo') {
    const seed = demoSeed()
    nextSettings = mergeSettings(nextSettings, seed.settings)
    nextRules = seed.managerRules
    nextProposals = seed.proposals
  }
  settings.value = nextSettings
  overrides.value = stored?.overrides && typeof stored.overrides === 'object' ? stored.overrides : {}
  distributions.value = stored?.distributions && typeof stored.distributions === 'object' ? stored.distributions : {}
  managerRules.value = nextRules
  names.value = stored?.names && typeof stored.names === 'object' ? stored.names : {}
  proposals.value = nextProposals
  packages.value = stored?.packages && typeof stored.packages === 'object' ? stored.packages : {}
  ready.value = true
  reclampAll()
  persist()
}

function persist() {
  if (!ready.value) return
  localStorage.setItem(
    storageKey(org.value.signature),
    JSON.stringify({
      settings: settings.value,
      overrides: overrides.value,
      distributions: distributions.value,
      managerRules: managerRules.value,
      names: names.value,
      proposals: proposals.value,
      packages: packages.value,
    }),
  )
}

watch(() => org.value.signature, (signature) => hydrate(signature), { immediate: true })

watch(
  org,
  () => {
    if (!org.value.actors.some((item) => item.id === actorId.value)) actorId.value = 'hr'
  },
  { immediate: true },
)

watch([settings, overrides, distributions, managerRules, names, proposals, packages], persist, { deep: true })

watch(
  () =>
    [
      settings.value.personCapPct,
      settings.value.overBudget,
      settings.value.budgetMode,
      settings.value.aboveBandPolicy,
      settings.value.aboveBandCompa,
      settings.value.newHireMonths,
      settings.value.referenceDate,
      settings.value.cascadeMode,
      settings.value.allocationMode,
      settings.value.matrix?.mode,
      settings.value.matrix?.tolerancePct,
      settings.value.matrix?.enabled,
      JSON.stringify(settings.value.enabledLevers),
      JSON.stringify(settings.value.ruleOwnership),
      JSON.stringify(managerRules.value),
      leverWeightSum.value,
      plan.value.rows.map((row) => Math.round(row.budget)).join(','),
    ].join('|'),
  () => {
    if (ready.value) reclampAll()
  },
)

function reclampAll() {
  let next = { ...proposals.value }
  let changed = false
  for (const card of org.value.cards) {
    const rules = rulesFor(settings.value, managerRules.value, card.id)
    for (const person of card.reports) {
      if (!next[person.id]) continue
      let prev = proposalOf(next, person.id)
      if (rules.levers[prev.lever] === false) {
        const fallback = LEVERS.find((lever) => rules.levers[lever.id] !== false)?.id || 'merit'
        prev = { ...prev, lever: fallback, newLevel: '' }
        next = { ...next, [person.id]: prev }
        changed = true
      }
      const result = nextAmount({
        card,
        proposals: next,
        settings: settings.value,
        budget: plan.value.proposalBudget[card.id] || 0,
        personId: person.id,
        rawAmount: prev.amount,
        managerRules: managerRules.value,
      })
      if (result.amount !== prev.amount || changed) {
        next = { ...next, [person.id]: { ...prev, amount: result.amount } }
        changed = true
      }
    }
  }
  if (changed) proposals.value = next
}

function setPoolMode(mode) {
  if (mode === 'absolute' && !(Number(settings.value.poolAbsolute) > 0)) {
    const current = cyclePool({ ...settings.value, poolMode: 'percent' }, org.value.people)
    settings.value.poolAbsolute = Math.round(current.amount)
  }
  settings.value.poolMode = mode
}

function setOwnership(key, value) {
  settings.value = {
    ...settings.value,
    ruleOwnership: { ...settings.value.ruleOwnership, [key]: value },
  }
}

function setEnabledLever(id, checked) {
  const next = { ...settings.value.enabledLevers, [id]: checked }
  if (!LEVERS.some((lever) => next[lever.id] !== false)) return
  settings.value = { ...settings.value, enabledLevers: next }
}

function setMatrixCell(rowId, colId, raw) {
  const value = Math.max(0, Number(String(raw).replace(',', '.')) || 0)
  settings.value.matrix.cells[rowId][colId] = value
}

function setNoPerf(colId, raw) {
  const value = Math.max(0, Number(String(raw).replace(',', '.')) || 0)
  settings.value.matrix.noPerf[colId] = value
}

function setBandEdit(key, field, raw) {
  const value = Math.max(0, Math.round(parseEuroInput(raw)))
  const prev = settings.value.bandEdits?.[key] || {}
  settings.value = {
    ...settings.value,
    bandEdits: { ...settings.value.bandEdits, [key]: { ...prev, [field]: value } },
  }
}

function setOverride(card, reportsPayroll, mode, raw) {
  if (mode === 'percent') {
    const percent = Math.max(0, Number(String(raw).replace(',', '.')) || 0)
    overrides.value = {
      ...overrides.value,
      [card.id]: { manual: true, mode: 'percent', percent, amount: Math.round((reportsPayroll * percent) / 100) },
    }
    return
  }
  const amount = Math.max(0, Math.round(parseEuroInput(raw)))
  const percent = reportsPayroll > 0 ? (amount / reportsPayroll) * 100 : 0
  overrides.value = {
    ...overrides.value,
    [card.id]: { manual: true, mode: 'absolute', percent, amount },
  }
}

function writeDistribution(row, amount) {
  const parentId = row.kind === 'retained' ? row.card.id : row.card.parentId
  const field = row.kind === 'retained' ? '__retained' : row.card.id
  const parent = nodeOf(parentId)
  const current = {}
  for (const item of redistributeRows({ id: parentId })) {
    const id = item.kind === 'retained' ? '__retained' : item.card.id
    current[id] = Math.round(item.budget)
  }
  const others = Object.entries(current)
    .filter(([id]) => id !== field)
    .reduce((sum, [, value]) => sum + value, 0)
  const cap = Math.max(0, Math.round(parent?.budget || 0) - others)
  current[field] = Math.min(Math.max(0, Math.round(amount)), cap)
  const children = {}
  for (const [id, value] of Object.entries(current)) {
    if (id !== '__retained') children[id] = value
  }
  distributions.value = {
    ...distributions.value,
    [parentId]: { retained: current.__retained ?? null, children },
  }
}

function setAllocation(row, mode, raw) {
  const payroll = row.scopePayroll
  const amount =
    mode === 'percent'
      ? Math.round((payroll * Math.max(0, Number(String(raw).replace(',', '.')) || 0)) / 100)
      : Math.max(0, Math.round(parseEuroInput(raw)))
  if (isDistributionRow(row)) writeDistribution(row, amount)
  else setOverride(row.card, payroll, 'absolute', amount)
}

function resetRow(row) {
  if (!isDistributionRow(row)) {
    const next = { ...overrides.value }
    delete next[row.card.id]
    overrides.value = next
    return
  }
  const parentId = row.kind === 'retained' ? row.card.id : row.card.parentId
  const prev = distributions.value[parentId] || { children: {} }
  if (row.kind === 'retained') {
    distributions.value = { ...distributions.value, [parentId]: { ...prev, retained: null } }
    return
  }
  const children = { ...(prev.children || {}) }
  delete children[row.card.id]
  distributions.value = { ...distributions.value, [parentId]: { ...prev, children } }
}

function resetAllOverrides() {
  overrides.value = {}
  distributions.value = {}
}

function renameManager(id, value) {
  names.value = { ...names.value, [id]: value }
}

function setSplit(key, raw) {
  const value = Math.max(0, Number(String(raw).replace(',', '.')) || 0)
  settings.value = { ...settings.value, leverSplit: { ...settings.value.leverSplit, [key]: value } }
}

function patchManagerRule(cardId, patch) {
  const prev = managerRules.value[cardId] || {}
  managerRules.value = { ...managerRules.value, [cardId]: { ...prev, ...patch } }
}

function setManagerLever(card, leverId, checked) {
  const levers = { ...cardRules(card).levers, [leverId]: checked }
  if (!LEVERS.some((lever) => levers[lever.id] !== false)) return
  patchManagerRule(card.id, { levers })
}

function historyEntry(action, comment = '') {
  return { at: new Date().toISOString(), action, actorName: actor.value?.name || 'HR', comment }
}

function savePkg(id, pkg) {
  packages.value = { ...packages.value, [id]: pkg }
}

function setAmount(card, person, raw, event) {
  const result = nextAmount({
    card,
    proposals: proposals.value,
    settings: settings.value,
    budget: plan.value.proposalBudget[card.id] || 0,
    personId: person.id,
    rawAmount: raw,
    managerRules: managerRules.value,
  })
  const prev = proposalOf(proposals.value, person.id)
  proposals.value = { ...proposals.value, [person.id]: { ...prev, amount: result.amount } }
  const hint = result.flags.capped
    ? 'Applicato il tetto individuale'
    : result.flags.matrixBlocked
      ? 'Importo riportato al massimo della matrice'
      : result.flags.blockedByBudget
        ? 'Importo riportato al residuo di budget'
        : ''
  rowHints.value = { ...rowHints.value, [person.id]: hint }
  if (event?.target) event.target.value = result.amount ? String(result.amount) : ''
}

function setLever(card, person, lever) {
  const prev = proposalOf(proposals.value, person.id)
  proposals.value = {
    ...proposals.value,
    [person.id]: { ...prev, lever, newLevel: lever === 'promotion' ? prev.newLevel : '' },
  }
  if (prev.amount > 0) setAmount(card, person, prev.amount)
}

function setNewLevel(person, value) {
  const prev = proposalOf(proposals.value, person.id)
  proposals.value = { ...proposals.value, [person.id]: { ...prev, newLevel: value } }
}

function setMotivation(person, value) {
  const prev = proposalOf(proposals.value, person.id)
  proposals.value = { ...proposals.value, [person.id]: { ...prev, motivation: value } }
}

function setMotivationNote(person, value) {
  const prev = proposalOf(proposals.value, person.id)
  proposals.value = { ...proposals.value, [person.id]: { ...prev, motivationNote: value } }
}

function isCardOpen(id) {
  if (Object.prototype.hasOwnProperty.call(openCards.value, id)) return !!openCards.value[id]
  if (actor.value?.kind === 'manager' || actor.value?.kind === 'director') return true
  return id === schedeCards.value[0]?.id
}

function toggleCard(id) {
  openCards.value = { ...openCards.value, [id]: !isCardOpen(id) }
}

function toggleExpand(id) {
  expanded.value = { ...expanded.value, [id]: !isExpanded(id) }
}

function submitCard(card) {
  const evaluation = evaluations.value[card.id]
  const reasons = submitBlockers(evaluation, settings.value)
  if (reasons.length) {
    notices.value = { ...notices.value, [card.id]: reasons.join(' ') }
    return
  }
  const status = submitStatus(settings.value, card)
  const prev = pkgOf(card.id)
  const action =
    status === 'pending_l2' ? 'Inviato al responsabile' : status === 'pending_hrbp' ? 'Inviato all’HRBP' : 'Inviato a HR'
  savePkg(card.id, { ...prev, status, comment: '', history: [...prev.history, historyEntry(action)] })
  notices.value = { ...notices.value, [card.id]: '' }
  actionError.value = ''
}

function approveCard(card) {
  const prev = pkgOf(card.id)
  const status = approveStatus(prev.status)
  const action = status === 'approved' ? 'Approvato da HR' : 'Approvato, inoltrato a HR'
  savePkg(card.id, { ...prev, status, comment: '', history: [...prev.history, historyEntry(action)] })
  actionError.value = ''
}

function rejectCard(card) {
  const reason = (rejectNotes.value[card.id] || '').trim()
  if (!reason) {
    actionError.value = 'Scrivi il motivo del respingimento.'
    return
  }
  const prev = pkgOf(card.id)
  savePkg(card.id, {
    ...prev,
    status: 'rejected',
    comment: reason,
    history: [...prev.history, historyEntry('Rimandato al manager', reason)],
  })
  actionError.value = ''
}

function resetCycleData() {
  proposals.value = {}
  packages.value = {}
  rowHints.value = {}
  notices.value = {}
  rejectNotes.value = {}
  actionError.value = ''
}

function perfLabel(person) {
  if (person.performance == null || !Number.isFinite(Number(person.performance))) return 'Non presente'
  const score = `${Math.round(Number(person.performance))}/100`
  return person.performanceOrigin === 'evaluation' ? `Valutazione ${score}` : score
}

function lastIncreaseLabel(person) {
  if (person.lastIncreasePct == null || !Number.isFinite(Number(person.lastIncreasePct))) return 'n/d'
  const pct = `${person.lastIncreasePct > 0 ? '+' : ''}${Number(person.lastIncreasePct).toLocaleString('it-IT', { maximumFractionDigits: 1 })}%`
  if (!person.lastIncreaseDate) return pct
  const date = new Date(`${person.lastIncreaseDate}T00:00:00`)
  if (Number.isNaN(date.getTime())) return pct
  const when = date.toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })
  return `${pct} · ${when}`
}

function bandText(person) {
  if (person.compa == null) return 'Banda non disponibile'
  if (person.position > 1) return 'Sopra la banda'
  if (person.position < 0) return 'Sotto la banda'
  return 'In banda'
}

function markLeft(person) {
  if (person.position == null) return '50%'
  return `${Math.min(100, Math.max(0, person.position * 100))}%`
}

function barWidth(spent, budget) {
  if (!budget) return spent > 0 ? '100%' : '0%'
  return `${Math.min(100, Math.max(0, (spent / budget) * 100))}%`
}

function statusClass(status) {
  if (status === 'approved') return 'is-ok'
  if (status === 'rejected') return 'is-bad'
  if (status === 'draft') return 'is-draft'
  return 'is-wait'
}

function formatWhen(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function proposalAmount(person) {
  const amount = proposalOf(proposals.value, person.id).amount
  return amount > 0 ? String(amount) : ''
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function downloadLetters(onlyId) {
  const list = onlyId ? letters.value.filter((row) => row.id === onlyId) : letters.value
  if (!list.length) return
  const { saveLettersPdf } = await import('../lib/salaryReviewLetters.js')
  saveLettersPdf(
    {
      companyName: props.companyName?.trim() || 'Azienda',
      cycleName: settings.value.cycleName,
      effectiveDate: settings.value.effectiveDate,
      generatedAt: new Date().toISOString().slice(0, 10),
      letters: list,
    },
    onlyId ? `lettera-${onlyId}.pdf` : 'lettere-salary-review.pdf',
  )
}

function downloadCsv() {
  if (!letters.value.length) return
  downloadBlob(payrollCsv(letters.value, settings.value.effectiveDate), 'salary-review-paghe.csv', 'text/csv;charset=utf-8')
}

function downloadCriteria() {
  if (!criteria.value.length) return
  downloadBlob(criteriaCsv(criteria.value, settings.value.effectiveDate), 'salary-review-criteri.csv', 'text/csv;charset=utf-8')
}

function downloadTemplate() {
  downloadBlob(hierarchyTemplateCsv(), 'gerarchia-salary-review.csv', 'text/csv;charset=utf-8')
}

async function onHierarchyFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const data = await file.arrayBuffer()
  const workbook = XLSX.read(data, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  const result = rowsToPeople(rows)
  importError.value = result.errors.join(' ')
  if (!result.people.length) return
  importedPeople.value = result.people
  localStorage.setItem(IMPORT_STORAGE_KEY, JSON.stringify(result.people))
}

function clearImport() {
  importedPeople.value = []
  localStorage.removeItem(IMPORT_STORAGE_KEY)
  importError.value = ''
}
</script>

<template>
  <div class="sr">
    <header class="sr-top">
      <div>
        <p class="sr-kicker">Compensation</p>
        <h1>Salary review</h1>
      </div>
      <label class="sr-actor">
        <span>Stai operando come</span>
        <select v-model="actorId">
          <option v-for="item in org.actors" :key="item.id" :value="item.id">{{ item.name }} · {{ item.hint }}</option>
        </select>
      </label>
    </header>

    <nav class="sr-tabs" aria-label="Salary review">
      <button type="button" :class="{ active: tab === 'budget' }" @click="tab = 'budget'">Budget</button>
      <button type="button" :class="{ active: tab === 'schede' }" @click="tab = 'schede'">Schede manager</button>
      <button type="button" :class="{ active: tab === 'approvazioni' }" @click="tab = 'approvazioni'">
        Approvazioni
        <em v-if="pendingForActor">{{ pendingForActor }}</em>
      </button>
      <button type="button" :class="{ active: tab === 'lettere' }" @click="tab = 'lettere'">Lettere e paghe</button>
    </nav>

    <div class="sr-body">
      <p class="sr-source">
        {{ org.sourceNote }}
        <button v-if="importedPeople.length" type="button" class="sr-link" @click="clearImport">Torna all’organico precedente</button>
      </p>

      <section v-if="tab === 'budget'" class="sr-stack">
        <div v-if="seesCompany" class="sr-kpis">
          <article>
            <span>Monte salari</span>
            <strong>{{ formatEuro(poolInfo.payroll) }}</strong>
            <small>{{ org.people.length }} persone in ciclo</small>
          </article>
          <article>
            <span>Pool</span>
            <strong>{{ formatEuro(central.pool) }}</strong>
            <small>{{ settings.poolMode === 'percent' ? formatPct(settings.poolPercent) + ' del monte' : 'Importo definito da HR' }}</small>
          </article>
          <article>
            <span>Allocato ai manager</span>
            <strong>{{ formatEuro(central.allocated) }}</strong>
            <small>{{ central.overAllocated ? 'Supera il pool' : 'Somma dei budget di scheda' }}</small>
          </article>
          <article>
            <span>Proposto</span>
            <strong>{{ formatEuro(central.spentAll) }}</strong>
            <small>Somma delle proposte vive</small>
          </article>
          <article>
            <span>Residuo centrale</span>
            <strong :class="{ 'is-neg': central.residual < -1 }">{{ formatEuro(central.residual) }}</strong>
            <small>{{ residualNote }}</small>
          </article>
        </div>

        <p v-if="seesCompany && central.overAllocated" class="sr-alert">
          L’allocazione supera il pool di {{ formatEuro(central.allocated - central.pool) }}.
        </p>
        <p v-if="central.returned > 0" class="sr-note">{{ formatEuro(central.returned) }} già approvati e non spesi sono tornati nel pool.</p>
        <p v-if="central.redistributable > 0" class="sr-note">
          {{ formatEuro(central.redistributable) }} approvati e non spesi sono ridistribuibili: riduci il budget di quel manager e assegnalo a un altro prima della chiusura.
        </p>
        <p v-if="central.forfeited > 0" class="sr-note">{{ formatEuro(central.forfeited) }} approvati e non spesi risultano persi.</p>
        <p v-if="dateError" class="sr-alert">{{ dateError }}</p>

        <div v-if="seesCompany" class="sr-grid">
          <section class="sr-card">
            <h2>Pool complessivo</h2>
            <p class="sr-help">{{ formula }}</p>
            <label class="sr-field">
              Nome ciclo
              <input v-model="settings.cycleName" type="text" :disabled="!isHr" />
            </label>
            <label class="sr-field">
              Cascata
              <select v-model="settings.cascadeMode" :disabled="!isHr">
                <option value="flat">Piatta: ogni manager riceve il budget da HR</option>
                <option value="hierarchy">Gerarchica: HR assegna i responsabili di primo livello</option>
              </select>
            </label>
            <div class="sr-inline">
              <label class="sr-radio">
                <input type="radio" name="pool-mode" value="percent" :checked="settings.poolMode === 'percent'" :disabled="!isHr" @change="setPoolMode('percent')" />
                Percentuale del monte salari
              </label>
              <label class="sr-radio">
                <input type="radio" name="pool-mode" value="absolute" :checked="settings.poolMode === 'absolute'" :disabled="!isHr" @change="setPoolMode('absolute')" />
                Importo assoluto
              </label>
            </div>
            <label v-if="settings.poolMode === 'percent'" class="sr-field">
              Percentuale
              <input v-model.number="settings.poolPercent" type="number" min="0" max="100" step="0.1" :disabled="!isHr" />
            </label>
            <label v-else class="sr-field">
              Importo pool
              <input v-model.number="settings.poolAbsolute" type="number" min="0" step="100" :disabled="!isHr" />
            </label>
            <p class="sr-help">Come si divide il pool tra i manager</p>
            <label class="sr-radio">
              <input v-model="settings.allocationMode" type="radio" value="percent" :disabled="!isHr" />
              Stessa % per tutti
            </label>
            <label class="sr-radio">
              <input v-model="settings.allocationMode" type="radio" value="absolute" :disabled="!isHr" />
              Importo assoluto per manager
            </label>
            <label class="sr-radio">
              <input v-model="settings.allocationMode" type="radio" value="weighted" :disabled="!isHr" />
              % ponderata
            </label>
            <label v-if="settings.allocationMode === 'weighted'" class="sr-field">
              Peso
              <select v-model="settings.weightBasis" :disabled="!isHr">
                <option value="compa">Più budget ai team con compa-ratio medio basso</option>
                <option value="performance">Più budget ai team con performance media alta</option>
              </select>
            </label>
          </section>

          <section class="sr-card">
            <h2>Regole</h2>
            <p class="sr-help">
              Budget totale, eleggibilità e data di riferimento restano di HR. Le altre regole possono essere lasciate al manager.
            </p>
            <label class="sr-field">
              Budget non speso dopo l’approvazione
              <select v-model="settings.unusedPolicy" :disabled="!isHr">
                <option value="return">Torna al pool centrale</option>
                <option value="redistribute">Ridistribuibile tra manager prima della chiusura</option>
                <option value="forfeit">Resta perso</option>
              </select>
            </label>
            <label class="sr-field">
              Leve sul budget
              <select v-model="settings.budgetMode" :disabled="!isHr">
                <option value="unified">Un unico budget per merito, una tantum e promozione</option>
                <option value="perLever">Un budget distinto per leva</option>
              </select>
            </label>
            <div v-if="settings.budgetMode === 'perLever'" class="sr-split">
              <label>Merito %<input :value="settings.leverSplit.merit" type="number" min="0" step="1" :disabled="!isHr" @input="setSplit('merit', $event.target.value)" /></label>
              <label>Una tantum %<input :value="settings.leverSplit.oneoff" type="number" min="0" step="1" :disabled="!isHr" @input="setSplit('oneoff', $event.target.value)" /></label>
              <label>Promozione %<input :value="settings.leverSplit.promotion" type="number" min="0" step="1" :disabled="!isHr" @input="setSplit('promotion', $event.target.value)" /></label>
            </div>
            <p v-if="settings.budgetMode === 'perLever'" class="sr-help">I pesi valgono {{ formatPct(leverWeightSum, 0) }} e vengono riportati a 100 in proporzione.</p>

            <label class="sr-field">
              Tetto per persona
              <select :value="settings.ruleOwnership.personCap" :disabled="!isHr" @change="setOwnership('personCap', $event.target.value)">
                <option v-for="opt in OWNERSHIP_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
              </select>
            </label>
            <label class="sr-field">Tetto %<input v-model.number="settings.personCapPct" type="number" min="0" max="100" step="0.5" :disabled="!isHr" /></label>

            <label class="sr-field">
              Leve consentite
              <select :value="settings.ruleOwnership.levers" :disabled="!isHr" @change="setOwnership('levers', $event.target.value)">
                <option v-for="opt in OWNERSHIP_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
              </select>
            </label>
            <div class="sr-checks">
              <label v-for="lever in LEVERS" :key="lever.id" class="sr-radio">
                <input type="checkbox" :checked="settings.enabledLevers[lever.id] !== false" :disabled="!isHr" @change="setEnabledLever(lever.id, $event.target.checked)" />
                {{ lever.label }}
              </label>
            </div>

            <label class="sr-field">
              Sopra la soglia di compa-ratio
              <select :value="settings.ruleOwnership.aboveBand" :disabled="!isHr" @change="setOwnership('aboveBand', $event.target.value)">
                <option v-for="opt in OWNERSHIP_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
              </select>
            </label>
            <div class="sr-split">
              <label>Soglia compa-ratio %, fissata da HR<input v-model.number="settings.aboveBandCompa" type="number" min="0" step="1" :disabled="!isHr" /></label>
              <label>
                Comportamento predefinito
                <select v-model="settings.aboveBandPolicy" :disabled="!isHr">
                  <option value="alert">Alert, l’aumento si può proporre</option>
                  <option value="block">Blocco, la persona non è eleggibile</option>
                </select>
              </label>
            </div>

            <label class="sr-field">
              Uso della merit matrix
              <select :value="settings.ruleOwnership.matrix" :disabled="!isHr" @change="setOwnership('matrix', $event.target.value)">
                <option v-for="opt in OWNERSHIP_OPTIONS" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
              </select>
            </label>
            <label class="sr-radio">
              <input v-model="settings.matrix.enabled" type="checkbox" :disabled="!isHr" />
              Usa la merit matrix
            </label>
            <label class="sr-field">
              Modalità
              <select v-model="settings.matrix.mode" :disabled="!isHr">
                <option value="indicative">Indicativa: lo scostamento è consentito, con alert</option>
                <option value="binding">Vincolante: fuori range l’importo viene bloccato</option>
              </select>
            </label>
            <div class="sr-split">
              <label>Soglia di scostamento, punti %<input v-model.number="settings.matrix.tolerancePct" type="number" min="0" step="0.1" :disabled="!isHr" /></label>
              <label>Alert gap di genere oltre %<input v-model.number="settings.gapAlertPct" type="number" min="0" step="0.5" :disabled="!isHr" /></label>
            </div>
            <p class="sr-help">Senza valutazione la matrice usa solo la posizione in banda. Se lo scostamento supera la soglia, la motivazione è obbligatoria.</p>
            <div class="sr-table-wrap">
              <table class="sr-table sr-matrix">
                <thead>
                  <tr>
                    <th>Performance</th>
                    <th v-for="col in MATRIX_COLUMNS" :key="col.id">{{ col.label }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in settings.matrix.rows" :key="row.id">
                    <td>{{ row.label }}</td>
                    <td v-for="col in MATRIX_COLUMNS" :key="col.id">
                      <input class="sr-num" type="number" min="0" step="0.1" :value="settings.matrix.cells[row.id][col.id]" :disabled="!isHr" @change="setMatrixCell(row.id, col.id, $event.target.value)" />
                    </td>
                  </tr>
                  <tr>
                    <td>Senza valutazione</td>
                    <td v-for="col in MATRIX_COLUMNS" :key="col.id">
                      <input class="sr-num" type="number" min="0" step="0.1" :value="settings.matrix.noPerf[col.id]" :disabled="!isHr" @change="setNoPerf(col.id, $event.target.value)" />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <label class="sr-field">
              Se si sfora il budget
              <select v-model="settings.overBudget" :disabled="!isHr">
                <option value="alert">Alert, la proposta resta</option>
                <option value="block">Blocco, l’importo torna al residuo</option>
              </select>
            </label>
            <div class="sr-split">
              <label>Neoassunti sotto i mesi, fissato da HR<input v-model.number="settings.newHireMonths" type="number" min="0" step="1" :disabled="!isHr" /></label>
              <label>Data di riferimento eleggibilità<input v-model="settings.referenceDate" type="date" :disabled="!isHr" /></label>
            </div>
            <label class="sr-field">
              Secondo livello di approvazione
              <select v-model="settings.secondApprover" :disabled="!isHr">
                <option value="manager">Il responsabile del manager, poi HR</option>
                <option value="hrbp">HRBP, poi HR</option>
                <option value="none">Solo HR</option>
              </select>
            </label>
            <label class="sr-field">Decorrenza aumenti<input v-model="settings.effectiveDate" type="date" :disabled="!isHr" /></label>
          </section>
        </div>

        <section v-if="seesCompany" class="sr-card">
          <h2>Bande retributive</h2>
          <p class="sr-help">
            Sorgente in uso: {{ BAND_SOURCE_LABEL[org.bandSource] || 'Non disponibile' }}.
            Se l’analisi Transparency ha una pesatura, quella resta la sorgente preferita. Altrimenti puoi calcolare min, mid e max dalla distribuzione interna.
          </p>
          <label class="sr-field">
            Sorgente bande
            <select v-model="settings.bandSource" :disabled="!isHr">
              <option value="weighting">Pesatura Transparency, se presente</option>
              <option value="ccnlFamily">Livello CCNL + job family</option>
              <option value="level">Solo livello CCNL</option>
            </select>
          </label>
          <p v-if="!bands.length" class="sr-note">Le bande già definite sulle persone restano in uso finché non cambi sorgente.</p>
          <div v-else class="sr-table-wrap">
            <table class="sr-table">
              <thead>
                <tr>
                  <th>Gruppo</th>
                  <th>Persone</th>
                  <th>Min</th>
                  <th>Mid</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="band in bands" :key="band.key">
                  <td>{{ band.label }}<small v-if="band.edited">Modificata a mano</small></td>
                  <td>{{ band.n }}</td>
                  <td><input class="sr-num" type="number" min="0" step="100" :value="Math.round(band.min || 0)" :disabled="!isHr" @change="setBandEdit(band.key, 'min', $event.target.value)" /></td>
                  <td>{{ formatEuro(band.mid) }}</td>
                  <td><input class="sr-num" type="number" min="0" step="100" :value="Math.round(band.max || 0)" :disabled="!isHr" @change="setBandEdit(band.key, 'max', $event.target.value)" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="sr-card">
          <div class="sr-card-head">
            <div>
              <h2>Allocazione per manager</h2>
              <p class="sr-help">
                {{ settings.cascadeMode === 'hierarchy' ? 'HR assegna il primo livello. Chi ha manager sotto di sé divide il budget e può trattenere una quota per le persone dirette.' : 'Ogni manager riceve il budget direttamente da HR, con la stessa vista ad albero.' }}
              </p>
            </div>
            <div class="sr-actions tight">
              <button v-if="isHr" type="button" class="sr-btn" @click="downloadTemplate">Scarica modello</button>
              <label v-if="isHr" class="sr-btn sr-file">
                Importa gerarchia
                <input type="file" accept=".csv,.xlsx,.xls,text/csv" @change="onHierarchyFile" />
              </label>
              <button type="button" class="sr-btn" :disabled="!isHr" @click="resetAllOverrides">Ricalcola tutta la cascata</button>
            </div>
          </div>
          <p v-if="importError" class="sr-alert">{{ importError }}</p>
          <div class="sr-table-wrap">
            <table class="sr-table">
              <thead>
                <tr>
                  <th>Manager</th>
                  <th>Riporti</th>
                  <th>Monte</th>
                  <th>% sul monte</th>
                  <th>Budget</th>
                  <th>Vs cascata</th>
                  <th>Residuo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in treeRows" :key="row.key">
                  <td>
                    <div class="sr-tree" :style="{ paddingLeft: `${row.depth * 1.05}rem` }">
                      <button v-if="row.hasChildren" type="button" class="sr-expander" :aria-expanded="isExpanded(row.card.id)" @click="toggleExpand(row.card.id)">
                        {{ isExpanded(row.card.id) ? '▾' : '▸' }}
                      </button>
                      <span v-else class="sr-expander"></span>
                      <div v-if="row.kind === 'node'">
                        <input class="sr-name" :value="displayName(row.card)" :disabled="!isHr" @change="renameManager(row.card.id, $event.target.value)" />
                        <small>{{ row.card.role }}</small>
                      </div>
                      <div v-else>
                        <strong>Quota persone dirette</strong>
                        <small>Resta su questa scheda</small>
                      </div>
                    </div>
                  </td>
                  <td>{{ peopleCount(row) }}</td>
                  <td>{{ formatEuro(row.scopePayroll) }}</td>
                  <td>
                    <input class="sr-num" type="number" min="0" step="0.1" :value="Number(row.pct.toFixed(2))" :disabled="!canEditAllocation(row)" @change="setAllocation(row, 'percent', $event.target.value)" />
                  </td>
                  <td>
                    <input class="sr-num" type="number" min="0" step="100" :value="Math.round(row.budget)" :disabled="!canEditAllocation(row)" @change="setAllocation(row, 'absolute', $event.target.value)" />
                  </td>
                  <td :class="varianceClass(row)">{{ varianceText(row) }}</td>
                  <td :class="{ 'is-neg': row.residual != null && row.residual < -1 }">{{ row.residual == null ? '—' : formatEuro(row.residual) }}</td>
                  <td>
                    <button v-if="row.manual" type="button" class="sr-link" :disabled="!canEditAllocation(row)" @click="resetRow(row)">Torna alla cascata</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>

      <section v-else-if="tab === 'schede'" class="sr-stack">
        <p v-if="!schedeCards.length" class="sr-note">Nessuna scheda assegnata a questo profilo.</p>
        <article v-for="card in schedeCards" :key="card.id" class="sr-card">
          <button type="button" class="sr-scheda-head" @click="toggleCard(card.id)">
            <div>
              <h2>{{ displayName(card) }}</h2>
              <p>{{ card.role }} · {{ card.reports.length }} persone · {{ STATUS_LABEL[pkgOf(card.id).status] }}</p>
            </div>
            <div class="sr-scheda-budget">
              <span>Residuo</span>
              <strong :class="{ 'is-neg': evaluations[card.id].residual.all < -1 }">{{ formatEuro(evaluations[card.id].residual.all) }}</strong>
              <small>
                su {{ formatEuro(evaluations[card.id].budget) }}
                <template v-if="settings.cascadeMode === 'hierarchy' && nodeOf(card.id)?.hasChildren"> · perimetro {{ formatEuro(nodeOf(card.id).budget) }}</template>
              </small>
            </div>
          </button>

          <div v-if="isCardOpen(card.id)" class="sr-scheda-body">
            <section class="sr-rulesbox">
              <h3>Regole del tuo ciclo</h3>
              <div class="sr-rules-cols">
                <div>
                  <h4>Fissate da HR</h4>
                  <ul>
                    <li>Budget della scheda {{ formatEuro(evaluations[card.id].budget) }}</li>
                    <li>Eleggibilità: neoassunti sotto i {{ settings.newHireMonths }} mesi, riferimento {{ settings.referenceDate }}</li>
                    <li v-if="cardRules(card).ownership.personCap === 'hr'">Tetto {{ formatPct(cardRules(card).personCapPct, 0) }} a persona</li>
                    <li v-if="cardRules(card).ownership.levers === 'hr'">Leve: {{ leverNames(card) }}</li>
                    <li v-if="cardRules(card).ownership.aboveBand === 'hr'">
                      Compa sopra {{ settings.aboveBandCompa }}%: {{ cardRules(card).aboveBandPolicy === 'block' ? 'blocco' : 'alert' }}
                    </li>
                    <li v-if="cardRules(card).ownership.matrix === 'hr'">
                      Matrice {{ cardRules(card).matrixEnabled ? (cardRules(card).matrixMode === 'binding' ? 'vincolante' : 'indicativa') : 'non usata' }}
                    </li>
                  </ul>
                </div>
                <div>
                  <h4>Scelte del manager</h4>
                  <p v-if="!managerCanChoose(card)" class="sr-help">In questo ciclo le regole di dettaglio sono fissate da HR.</p>
                  <template v-else>
                    <label v-if="cardRules(card).ownership.personCap !== 'hr'" class="sr-field">
                      Tetto per persona %
                      <input type="number" min="0" max="100" step="0.5" :value="cardRules(card).personCapPct" :disabled="!canTweak(card, 'personCap')" @change="patchManagerRule(card.id, { personCapPct: Number($event.target.value) })" />
                    </label>
                    <div v-if="cardRules(card).ownership.levers !== 'hr'" class="sr-checks">
                      <label v-for="lever in LEVERS" :key="lever.id" class="sr-radio">
                        <input type="checkbox" :checked="cardRules(card).levers[lever.id] !== false" :disabled="!canTweak(card, 'levers')" @change="setManagerLever(card, lever.id, $event.target.checked)" />
                        {{ lever.label }}
                      </label>
                    </div>
                    <label v-if="cardRules(card).ownership.aboveBand !== 'hr'" class="sr-field">
                      Sopra la soglia di compa-ratio
                      <select :value="cardRules(card).aboveBandPolicy" :disabled="!canTweak(card, 'aboveBand')" @change="patchManagerRule(card.id, { aboveBandPolicy: $event.target.value })">
                        <option value="alert">Alert</option>
                        <option value="block">Blocco</option>
                      </select>
                    </label>
                    <template v-if="cardRules(card).ownership.matrix !== 'hr'">
                      <label class="sr-radio">
                        <input type="checkbox" :checked="cardRules(card).matrixEnabled" :disabled="!canTweak(card, 'matrix')" @change="patchManagerRule(card.id, { matrixEnabled: $event.target.checked })" />
                        Usa la merit matrix
                      </label>
                      <label class="sr-field">
                        Modalità
                        <select :value="cardRules(card).matrixMode" :disabled="!canTweak(card, 'matrix')" @change="patchManagerRule(card.id, { matrixMode: $event.target.value })">
                          <option value="indicative">Indicativa</option>
                          <option value="binding">Vincolante</option>
                        </select>
                      </label>
                    </template>
                  </template>
                </div>
              </div>
            </section>

            <section v-if="showRedistribute(card)" class="sr-redistribute">
              <h3>Ridistribuisci budget</h3>
              <p class="sr-help">
                Hai {{ formatEuro(nodeOf(card.id).budget) }} da dividere. La somma dei manager e della quota diretta non può superare questo importo. Residuo {{ formatEuro(nodeOf(card.id).residual || 0) }}.
              </p>
              <div class="sr-table-wrap">
                <table class="sr-table">
                  <thead>
                    <tr>
                      <th>Destinazione</th>
                      <th>Monte</th>
                      <th>Budget</th>
                      <th>Vs cascata</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="row in redistributeRows(card)" :key="row.key">
                      <td>{{ row.kind === 'retained' ? 'Quota persone dirette' : displayName(row.card) }}</td>
                      <td>{{ formatEuro(row.scopePayroll) }}</td>
                      <td>
                        <input class="sr-num" type="number" min="0" step="100" :value="Math.round(row.budget)" :disabled="!canEditAllocation(row)" @change="setAllocation(row, 'absolute', $event.target.value)" />
                      </td>
                      <td :class="varianceClass(row)">{{ varianceText(row) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div class="sr-bar" aria-hidden="true">
              <div class="sr-bar-fill" :class="{ over: evaluations[card.id].overBudget }" :style="{ width: barWidth(evaluations[card.id].spent.all, evaluations[card.id].budget) }"></div>
            </div>
            <p v-if="settings.budgetMode === 'perLever'" class="sr-lever-res">
              <span>Merito {{ formatEuro(evaluations[card.id].residual.merit) }}</span>
              <span>Una tantum {{ formatEuro(evaluations[card.id].residual.oneoff) }}</span>
              <span>Promozione {{ formatEuro(evaluations[card.id].residual.promotion) }}</span>
            </p>
            <p v-if="evaluations[card.id].overBudget" class="sr-alert">
              {{ settings.overBudget === 'block' ? 'Il budget è stato riportato dentro il tetto.' : 'Alert: le proposte superano il budget. Si possono inviare comunque.' }}
            </p>
            <p v-if="pkgOf(card.id).status === 'rejected' && pkgOf(card.id).comment" class="sr-alert">Rimandata: {{ pkgOf(card.id).comment }}</p>

            <section class="sr-impact">
              <h3>Impatto sulla trasparenza</h3>
              <p class="sr-help">Stessa formula del tab Transparency: (media uomini − media donne) / media uomini. Positivo quando la media degli uomini è più alta.</p>
              <div class="sr-impact-grid">
                <article>
                  <span>Gap del perimetro</span>
                  <strong>{{ gapText(evaluations[card.id].transparency.before) }} → {{ gapText(evaluations[card.id].transparency.after) }}</strong>
                </article>
                <article>
                  <span>Fuori banda</span>
                  <strong>{{ evaluations[card.id].transparency.outOfBand.before }} → {{ evaluations[card.id].transparency.outOfBand.after }}</strong>
                </article>
              </div>
              <div class="sr-table-wrap">
                <table class="sr-table">
                  <thead>
                    <tr>
                      <th>Livello</th>
                      <th>Prima</th>
                      <th>Dopo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="level in evaluations[card.id].transparency.byLevel" :key="level.level">
                      <td>{{ level.level }}</td>
                      <td>{{ gapText(level.before) }}</td>
                      <td>{{ gapText(level.after) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <div class="sr-table-wrap">
              <table class="sr-table sr-people">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>RAL</th>
                    <th>Banda / compa</th>
                    <th>Performance</th>
                    <th>Ultimo aumento</th>
                    <th>Leva</th>
                    <th>Proposta</th>
                    <th>Nuova RAL</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in evaluations[card.id].rows" :key="row.person.id" :class="{ locked: row.elig.blocking }">
                    <td>
                      <strong>{{ row.person.name }}</strong>
                      <small>{{ row.person.role }} · {{ row.person.level }}</small>
                      <small v-for="flag in row.elig.flags" :key="flag.code" :class="flag.blocking ? 'is-bad' : 'is-wait'">{{ flag.label }}</small>
                      <small v-for="(alert, index) in row.alerts" :key="index" class="is-bad">{{ alert }}</small>
                    </td>
                    <td>{{ formatEuro(row.person.ral) }}</td>
                    <td>
                      <div v-if="row.person.compa != null" class="sr-compa">
                        <div class="sr-band-track"><i :style="{ left: markLeft(row.person) }" :class="{ over: row.person.position > 1 }"></i></div>
                        <span>{{ Math.round(row.person.compa) }}% · {{ bandText(row.person) }}</span>
                        <small>{{ BAND_SOURCE_LABEL[row.person.bandSource] }}</small>
                      </div>
                      <span v-else>n/d</span>
                    </td>
                    <td>
                      {{ perfLabel(row.person) }}
                      <small v-if="row.person.performanceOrigin === 'none'">Matrice sulla sola posizione in banda</small>
                      <small v-else-if="row.person.performanceOrigin === 'evaluation'">Dal modulo Valutazioni</small>
                    </td>
                    <td>{{ lastIncreaseLabel(row.person) }}</td>
                    <td>
                      <select :value="row.proposal.lever" :disabled="row.elig.blocking || !canEdit(actorId, card, pkgOf(card.id).status)" @change="setLever(card, row.person, $event.target.value)">
                        <option v-for="lever in leversFor(card)" :key="lever.id" :value="lever.id">{{ lever.label }}</option>
                      </select>
                      <input v-if="row.proposal.lever === 'promotion'" class="sr-level" list="sr-levels" placeholder="Nuovo livello" :value="row.proposal.newLevel" :disabled="row.elig.blocking || !canEdit(actorId, card, pkgOf(card.id).status)" @change="setNewLevel(row.person, $event.target.value)" />
                    </td>
                    <td>
                      <input class="sr-num" type="number" min="0" step="100" :value="row.elig.blocking ? '' : proposalAmount(row.person)" :disabled="row.elig.blocking || !canEdit(actorId, card, pkgOf(card.id).status)" @input="setAmount(card, row.person, $event.target.value, $event)" />
                      <small v-if="cardRules(card).matrixEnabled && row.proposal.lever !== 'oneoff'">Consigliato {{ formatPct(row.matrixPct) }} · {{ formatEuro(row.matrixAmount) }}</small>
                      <small v-if="row.needsMotivation" class="is-wait">Fuori matrice</small>
                      <small v-if="rowHints[row.person.id]">{{ rowHints[row.person.id] }}</small>
                      <small>max {{ formatEuro(row.cap) }}</small>
                      <template v-if="row.needsMotivation || row.proposal.motivation">
                        <select class="sr-level" :value="row.proposal.motivation" :disabled="!canEdit(actorId, card, pkgOf(card.id).status)" @change="setMotivation(row.person, $event.target.value)">
                          <option value="">Motivazione</option>
                          <option v-for="item in MOTIVATIONS" :key="item.id" :value="item.id">{{ item.label }}</option>
                        </select>
                        <input class="sr-level" type="text" placeholder="Nota, obbligatoria se scegli Altro" :value="row.proposal.motivationNote" :disabled="!canEdit(actorId, card, pkgOf(card.id).status)" @change="setMotivationNote(row.person, $event.target.value)" />
                      </template>
                    </td>
                    <td>
                      {{ formatEuro(newRal(row.person, row.proposal.lever === 'oneoff' || row.elig.blocking ? { lever: 'oneoff', amount: 0 } : row.proposal)) }}
                      <small v-if="row.proposal.lever === 'oneoff' && row.proposal.amount > 0 && !row.elig.blocking">una tantum {{ formatEuro(row.proposal.amount) }}, RAL invariata</small>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="sr-actions">
              <p v-if="notices[card.id]" class="sr-alert">{{ notices[card.id] }}</p>
              <button type="button" class="sr-btn primary" :disabled="!canSubmit(actorId, card, pkgOf(card.id).status)" @click="submitCard(card)">Invia in approvazione</button>
            </div>
          </div>
        </article>
        <datalist id="sr-levels">
          <option v-for="level in levels" :key="level" :value="level"></option>
        </datalist>
      </section>

      <section v-else-if="tab === 'approvazioni'" class="sr-stack">
        <div v-if="isHr" class="sr-subtabs">
          <button type="button" :class="{ active: approvalView === 'stato' }" @click="approvalView = 'stato'">Stato</button>
          <button type="button" :class="{ active: approvalView === 'calibrazione' }" @click="approvalView = 'calibrazione'">Calibrazione</button>
        </div>
        <p v-if="actionError" class="sr-alert">{{ actionError }}</p>

        <template v-if="isHr && approvalView === 'calibrazione'">
          <section class="sr-card">
            <div class="sr-card-head">
              <div>
                <h2>Calibrazione</h2>
                <p class="sr-help">Confronta i pacchetti prima dell’approvazione. Le eccezioni sono gli scostamenti dalla merit matrix.</p>
              </div>
              <label class="sr-radio">
                <input v-model="exceptionsOnly" type="checkbox" />
                Solo eccezioni e alert
              </label>
            </div>
            <div class="sr-table-wrap">
              <table class="sr-table">
                <thead>
                  <tr>
                    <th>Manager</th>
                    <th>Budget</th>
                    <th>Proposto</th>
                    <th>% del monte</th>
                    <th>Aumento medio</th>
                    <th>Eccezioni matrice</th>
                    <th>Alert</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in calibrationManagers" :key="row.card.id">
                    <td>
                      <strong>{{ displayName(row.card) }}</strong>
                      <small>{{ STATUS_LABEL[pkgOf(row.card.id).status] }}</small>
                    </td>
                    <td>{{ formatEuro(row.budget) }}</td>
                    <td>{{ formatEuro(row.proposed) }}</td>
                    <td>{{ formatPct(row.pct) }}</td>
                    <td>{{ formatPct(row.avgIncrease) }}</td>
                    <td>{{ row.exceptions }}</td>
                    <td>{{ row.alerts }}</td>
                    <td>
                      <div v-if="canReturn(actorId, pkgOf(row.card.id).status)" class="sr-return">
                        <input v-model="rejectNotes[row.card.id]" type="text" placeholder="Commento per il manager" />
                        <button type="button" class="sr-link" @click="rejectCard(row.card)">Rimanda</button>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <div class="sr-dist">
            <section v-for="block in [{ key: 'gender', title: 'Per genere' }, { key: 'level', title: 'Per livello' }, { key: 'performance', title: 'Per fascia di performance' }]" :key="block.key" class="sr-card">
              <h2>{{ block.title }}</h2>
              <p v-if="!calibrationDistribution[block.key].length" class="sr-note">Nessuna proposta in questo filtro.</p>
              <table v-else class="sr-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>N</th>
                    <th>Importo</th>
                    <th>Medio</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in calibrationDistribution[block.key]" :key="item.label">
                    <td>{{ item.label }}</td>
                    <td>{{ item.n }}</td>
                    <td>{{ formatEuro(item.amount) }}</td>
                    <td>{{ formatPct(item.avg) }}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </template>

        <template v-else>
          <p v-if="!inbox.length" class="sr-note">Nessun pacchetto visibile per questo profilo.</p>
          <article v-for="item in inbox" :key="item.card.id" class="sr-card">
            <div class="sr-approval-head">
              <div>
                <h2>{{ displayName(item.card) }}</h2>
                <p>{{ item.card.reports.length }} persone · proposto {{ formatEuro(item.evaluation.spent.all) }} su {{ formatEuro(item.evaluation.budget) }}</p>
              </div>
              <span class="sr-status" :class="statusClass(item.pkg.status)">{{ STATUS_LABEL[item.pkg.status] }}</span>
            </div>
            <p v-if="item.evaluation.overBudget" class="sr-alert">Questo pacchetto sfora il budget del manager.</p>
            <p v-if="item.evaluation.exceptions" class="sr-note">{{ item.evaluation.exceptions }} eccezioni alla matrice.</p>
            <p v-if="item.pkg.comment && item.pkg.status === 'rejected'" class="sr-alert">{{ item.pkg.comment }}</p>
            <ul v-if="item.pkg.history.length" class="sr-history">
              <li v-for="(event, index) in item.pkg.history" :key="index">
                <strong>{{ event.action }}</strong>
                <span>{{ event.actorName }} · {{ formatWhen(event.at) }}</span>
                <em v-if="event.comment">{{ event.comment }}</em>
              </li>
            </ul>
            <div v-if="canApprove(actorId, item.card, item.pkg.status) || canReject(actorId, item.card, item.pkg.status)" class="sr-actions">
              <label class="sr-field">
                Motivo se respingi
                <input v-model="rejectNotes[item.card.id]" type="text" placeholder="Motivo visibile al manager" />
              </label>
              <button v-if="canApprove(actorId, item.card, item.pkg.status)" type="button" class="sr-btn primary" @click="approveCard(item.card)">Approva</button>
              <button v-if="canReject(actorId, item.card, item.pkg.status)" type="button" class="sr-btn" @click="rejectCard(item.card)">Respingi</button>
            </div>
          </article>
        </template>
      </section>

      <section v-else class="sr-stack">
        <section class="sr-card">
          <div class="sr-card-head">
            <div>
              <h2>Lettere e tracciato paghe</h2>
              <p class="sr-help">Si generano solo gli aumenti dei pacchetti approvati da HR, con decorrenza {{ settings.effectiveDate }}. L’una tantum non modifica la nuova RAL. Le motivazioni restano nel file dei criteri.</p>
            </div>
            <div class="sr-actions tight">
              <button type="button" class="sr-btn primary" :disabled="!letters.length" @click="downloadLetters()">Scarica tutte le lettere</button>
              <button type="button" class="sr-btn" :disabled="!letters.length" @click="downloadCsv">Export paghe CSV</button>
              <button type="button" class="sr-btn" :disabled="!criteria.length" @click="downloadCriteria">Esporta motivazioni</button>
              <button v-if="isHr" type="button" class="sr-link" @click="resetCycleData">Azzera proposte del ciclo</button>
            </div>
          </div>
          <p v-if="!letters.length" class="sr-note">Nessuna proposta approvata. Il file paghe e le lettere compariranno dopo l’approvazione HR. L’export dei criteri include anche le proposte ancora aperte.</p>
          <div v-else class="sr-table-wrap">
            <table class="sr-table">
              <thead>
                <tr>
                  <th>Persona</th>
                  <th>Manager</th>
                  <th>Leva</th>
                  <th>RAL attuale</th>
                  <th>Importo</th>
                  <th>Nuova RAL</th>
                  <th>Motivazione</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in letters" :key="row.id">
                  <td>
                    <strong>{{ row.name }}</strong>
                    <small>{{ row.role }} · {{ row.level }}<template v-if="row.lever === 'promotion'"> → {{ row.newLevel }}</template></small>
                  </td>
                  <td>{{ row.managerName }}</td>
                  <td>{{ row.leverLabel }}</td>
                  <td>{{ formatEuro(row.ral) }}</td>
                  <td>{{ formatEuro(row.amount) }}</td>
                  <td>{{ formatEuro(row.newRal) }}</td>
                  <td>{{ row.motivationLabel || '—' }}<small v-if="row.motivationNote">{{ row.motivationNote }}</small></td>
                  <td><button type="button" class="sr-link" @click="downloadLetters(row.id)">Lettera PDF</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </div>
  </div>
</template>

<style scoped>
.sr { flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column; background: transparent; }
.sr-top { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 64px; padding: 0.75rem 1.25rem; background: #fff; border-bottom: 1px solid #e6ebf2; }
.sr-kicker { margin: 0; font-size: 0.68rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #3b82f6; }
.sr-top h1 { margin: 0; font-size: 1.15rem; font-weight: 650; color: #1e293b; }
.sr-actor { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.72rem; color: #64748b; }
.sr-actor select, .sr-field input, .sr-field select, .sr-split input, .sr-split select, .sr-table input, .sr-table select, .sr-name, .sr-num, .sr-level { border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: #1e293b; font: inherit; padding: 0.45rem 0.6rem; }
.sr-actor select { min-width: 280px; max-width: 420px; }
.sr-tabs, .sr-subtabs { display: flex; gap: 0.25rem; padding: 0 1.25rem; background: #fff; border-bottom: 1px solid #e6ebf2; }
.sr-subtabs { padding: 0.6rem 0 0; background: transparent; border-bottom: none; }
.sr-tabs button, .sr-subtabs button { border: none; border-bottom: 3px solid transparent; background: transparent; color: #1e293b; font: inherit; font-size: 0.875rem; padding: 0.75rem 0.9rem; cursor: pointer; }
.sr-subtabs button { padding: 0.4rem 0.8rem; font-size: 0.82rem; }
.sr-tabs button.active, .sr-subtabs button.active { color: #0a6cd2; font-weight: 650; border-bottom-color: #0a6cd2; }
.sr-tabs em { display: inline-flex; align-items: center; justify-content: center; min-width: 1.1rem; margin-left: 0.35rem; padding: 0 0.3rem; border-radius: 999px; background: #0a6cd2; color: #fff; font-style: normal; font-size: 0.72rem; }
.sr-body { flex: 1; min-height: 0; overflow: auto; padding: 1rem 1.25rem 2rem; }
.sr-source, .sr-help, .sr-note { color: #64748b; font-size: 0.84rem; }
.sr-source { margin: 0 0 0.9rem; }
.sr-stack { display: flex; flex-direction: column; gap: 0.9rem; }
.sr-kpis { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.7rem; }
.sr-kpis article, .sr-card, .sr-rulesbox, .sr-impact { background: #fff; border: 1px solid #e8edf3; border-radius: 12px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
.sr-kpis article { padding: 0.8rem 0.9rem; display: flex; flex-direction: column; gap: 0.15rem; }
.sr-kpis span, .sr-scheda-budget span, .sr-impact span { font-size: 0.72rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
.sr-kpis strong, .sr-scheda-budget strong { font-size: 1.05rem; color: #0f172a; }
.sr-kpis small, .sr-table small, .sr-scheda-budget small { color: #64748b; font-size: 0.75rem; }
.sr-card { padding: 1rem 1.05rem 1.1rem; }
.sr-card h2, .sr-scheda-head h2, .sr-approval-head h2, .sr-rulesbox h3, .sr-impact h3, .sr-redistribute h3 { margin: 0; font-size: 1rem; color: #1e293b; }
.sr-rulesbox h4 { margin: 0 0 0.35rem; font-size: 0.78rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.03em; }
.sr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
.sr-dist { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.9rem; }
.sr-field, .sr-split label { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.75rem; font-size: 0.8rem; color: #475569; }
.sr-inline, .sr-split, .sr-card-head, .sr-actions, .sr-approval-head, .sr-scheda-head, .sr-lever-res, .sr-tree, .sr-rules-cols, .sr-impact-grid { display: flex; gap: 0.8rem; align-items: center; }
.sr-inline, .sr-split, .sr-rules-cols, .sr-impact-grid { flex-wrap: wrap; }
.sr-rules-cols > div, .sr-impact-grid article { flex: 1; min-width: 220px; }
.sr-rulesbox, .sr-impact, .sr-redistribute { margin-top: 0.8rem; padding: 0.8rem 0.9rem; }
.sr-rulesbox ul { margin: 0; padding-left: 1.1rem; color: #334155; font-size: 0.84rem; }
.sr-rulesbox li + li { margin-top: 0.25rem; }
.sr-radio, .sr-checks { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.7rem; font-size: 0.84rem; color: #334155; }
.sr-checks { flex-wrap: wrap; }
.sr-split label { flex: 1; min-width: 140px; }
.sr-card-head, .sr-approval-head { justify-content: space-between; align-items: flex-start; }
.sr-table-wrap { overflow-x: auto; margin-top: 0.8rem; }
.sr-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
.sr-table th, .sr-table td { padding: 0.55rem 0.5rem; text-align: left; border-bottom: 1px solid #eef2f6; vertical-align: top; }
.sr-table th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #64748b; white-space: nowrap; }
.sr-table td strong, .sr-table td small { display: block; }
.sr-name { min-width: 180px; }
.sr-num { width: 110px; }
.sr-level { display: block; width: 180px; margin-top: 0.35rem; }
.sr-table select { max-width: 210px; }
.sr-tree { align-items: flex-start; }
.sr-expander { width: 1.4rem; flex: 0 0 1.4rem; border: none; background: transparent; color: #334155; font: inherit; cursor: pointer; padding: 0.35rem 0; }
.sr-scheda-head { width: 100%; border: none; background: transparent; padding: 0; text-align: left; cursor: pointer; font: inherit; justify-content: space-between; }
.sr-scheda-head p, .sr-approval-head p { margin: 0.15rem 0 0; color: #64748b; font-size: 0.8rem; }
.sr-scheda-budget { text-align: right; }
.sr-scheda-body { margin-top: 0.8rem; }
.sr-bar { height: 8px; border-radius: 99px; background: #e8eef5; overflow: hidden; margin-top: 0.8rem; }
.sr-bar-fill { height: 100%; background: #0a6cd2; }
.sr-bar-fill.over { background: #d97706; }
.sr-lever-res { margin: 0.45rem 0 0; color: #475569; font-size: 0.8rem; }
.sr-compa { min-width: 140px; }
.sr-band-track { position: relative; height: 6px; margin: 0.35rem 0; border-radius: 99px; background: linear-gradient(90deg, #bfdbfe, #86efac 50%, #fca5a5); }
.sr-band-track i { position: absolute; top: -3px; width: 10px; height: 12px; margin-left: -5px; border-radius: 2px; background: #0f172a; }
.sr-band-track i.over { background: #b91c1c; }
.sr-people tr.locked { background: #f8fafc; color: #94a3b8; }
.sr-alert, .sr-note { margin: 0.6rem 0 0; }
.sr-alert { color: #9a3412; background: #fff7ed; border-radius: 8px; padding: 0.45rem 0.6rem; font-size: 0.82rem; }
.is-neg, .is-bad { color: #b91c1c; }
.is-ok { color: #047857; }
.is-wait { color: #b45309; }
.sr-actions { margin-top: 0.8rem; flex-wrap: wrap; }
.sr-actions.tight { margin-top: 0; justify-content: flex-end; }
.sr-btn, .sr-link { border-radius: 8px; font: inherit; cursor: pointer; }
.sr-btn { border: 1px solid #d5deea; background: #fff; color: #1e293b; padding: 0.5rem 0.8rem; }
.sr-btn.primary { border: none; background: #0a6cd2; color: #fff; }
.sr-btn:disabled, .sr-link:disabled { opacity: 0.45; cursor: not-allowed; }
.sr-link { border: none; background: transparent; color: #0a6cd2; padding: 0; }
.sr-file { position: relative; overflow: hidden; }
.sr-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
.sr-return { display: flex; gap: 0.4rem; align-items: center; }
.sr-return input { width: 180px; }
.sr-status { border-radius: 999px; padding: 0.25rem 0.6rem; font-size: 0.75rem; font-weight: 650; background: #f1f5f9; color: #475569; white-space: nowrap; }
.sr-status.is-ok { background: #ecfdf5; color: #047857; }
.sr-status.is-bad { background: #fef2f2; color: #b91c1c; }
.sr-status.is-wait { background: #fffbeb; color: #b45309; }
.sr-history { list-style: none; margin: 0.7rem 0 0; padding: 0; }
.sr-history li { display: flex; flex-direction: column; gap: 0.05rem; padding: 0.4rem 0; border-top: 1px solid #eef2f6; font-size: 0.8rem; }
.sr-history span, .sr-history em { color: #64748b; }
@media (max-width: 1100px) {
  .sr-kpis, .sr-grid, .sr-dist { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 780px) {
  .sr-top, .sr-tabs { flex-wrap: wrap; }
  .sr-actor select { min-width: 0; width: 100%; }
  .sr-kpis, .sr-grid, .sr-dist { grid-template-columns: 1fr; }
}
</style>
