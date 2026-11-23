import type { CraneType, Priority } from '@prisma/client'
import type { TemplateField, TemplateSchema } from '@/lib/templates/schema'

/**
 * The 14 job types (brief §4.1) and the four templates Phase 1 actually builds (servicing, breakdown,
 * visual inspection, load test — §6.3).
 *
 * Everything here is data that becomes rows: the office can rename a job type, change a default
 * priority, or add a fifteenth without a deploy. Templates are versioned rows too — a published
 * version is never edited, a new version supersedes it, so an old report still renders as issued.
 * This module is the seed's source of truth and is not consulted at runtime.
 *
 * CHECKLIST WORDING IS A DRAFT. It follows the components the brief names, and the four tables below
 * are marked for review by the technicians who do the work before they are used on a real job.
 */

export interface JobTypeDefinition {
  code: string
  name: string
  description: string
  defaultPriority: Priority
  sortOrder: number
  /** Which of the four built templates this type gains, if any. */
  template?: TemplateKey
  /**
   * A Service Report: the technician grades every component 1–4 against this type's checklist, and
   * the approved report is numbered `SR<yy><mm><nnn>` instead of `RPT-…`.
   */
  isServiceReport?: boolean
  /** Documents the office expects back for this kind of visit. Free text keys, shown as a reminder. */
  requiredDocumentTypes?: string[]
  /**
   * Competency names this work demands, matched case-insensitively against `Competency.name`.
   * Office-owned data, seeded with sensible defaults and editable afterwards — which is why these
   * are plain words rather than keys.
   */
  requiredCompetencies?: string[]
}

export type TemplateKey = 'SERVICING' | 'BREAKDOWN' | 'VISUAL_INSPECTION' | 'LOAD_TEST'

export const JOB_TYPES: readonly JobTypeDefinition[] = [
  {
    code: 'PM',
    name: 'Scheduled servicing (PM)',
    description:
      'Planned maintenance visit against the crane schedule. Checklist covers every component the brief lists for servicing.',
    defaultPriority: 'P4',
    sortOrder: 10,
    template: 'SERVICING',
    isServiceReport: true,
    requiredDocumentTypes: [],
    requiredCompetencies: ['Crane servicing'],
  },
  {
    code: 'BREAKDOWN',
    name: 'Breakdown call-out',
    description: 'Crane down or degraded. Records reported fault, arrival, restoration and root cause.',
    defaultPriority: 'P1',
    sortOrder: 20,
    template: 'BREAKDOWN',
    requiredDocumentTypes: [],
    requiredCompetencies: ['Crane servicing'],
  },
  {
    code: 'VISUAL_INSPECTION',
    name: 'Visual inspection',
    description:
      'Structural and safety-device inspection by our technician. Findings raised by severity. Not a statutory examination.',
    defaultPriority: 'P3',
    sortOrder: 30,
    template: 'VISUAL_INSPECTION',
    requiredDocumentTypes: [],
    requiredCompetencies: ['Crane inspection'],
  },
  {
    code: 'LOAD_TEST',
    name: 'Load test',
    description:
      'Proof load test by our technician, with instruments recorded so the result is traceable. Not a statutory certificate.',
    defaultPriority: 'P3',
    sortOrder: 40,
    template: 'LOAD_TEST',
    requiredDocumentTypes: ['LOAD_TEST_CERTIFICATE'],
    requiredCompetencies: ['Load testing'],
  },
  {
    code: 'STATUTORY_EXAM_SUPPORT',
    name: 'Statutory examination support',
    description:
      'Preparing the crane and test load for an Authorised Examiner, then following up the certificate they issue.',
    defaultPriority: 'P3',
    sortOrder: 50,
    requiredDocumentTypes: ['STATUTORY_TEST_EXAMINATION'],
  },
  {
    code: 'INSTALLATION',
    name: 'Installation / commissioning',
    description: 'New crane or a re-assembly: scope, components fitted, torque and alignment records, handover.',
    defaultPriority: 'P3',
    sortOrder: 60,
  },
  {
    code: 'RECERTIFICATION',
    name: 'Re-certification / re-registration support',
    description: 'Paperwork and preparation for re-registration, which is triggered by a change of owner, UEN or location.',
    defaultPriority: 'P4',
    sortOrder: 70,
    requiredDocumentTypes: ['REGISTRATION'],
  },
  {
    code: 'REPAIR',
    name: 'Repair / modification',
    description: 'Repairs and modifications, including those that may require AE inspection afterwards.',
    defaultPriority: 'P2',
    sortOrder: 80,
  },
  {
    code: 'WIRE_ROPE_HOOK',
    name: 'Wire rope, hook or lifting gear replacement',
    description: 'Replacement work with serial traceability of the parts fitted.',
    defaultPriority: 'P2',
    sortOrder: 90,
    requiredDocumentTypes: ['LIFTING_GEAR_EXAM'],
    requiredCompetencies: ['Rigging'],
  },
  {
    code: 'SURVEY_QUOTE',
    name: 'Site survey / quotation only',
    description: 'No work performed. Exists so a site visit can be recorded and turned into a quote.',
    defaultPriority: 'P4',
    sortOrder: 100,
  },
  {
    code: 'FOLLOW_UP',
    name: 'Follow-up / defect rectification',
    description: 'Usually generated from a finding on a previous report. Links back to the job it follows.',
    defaultPriority: 'P2',
    sortOrder: 110,
  },
  {
    code: 'WARRANTY',
    name: 'Warranty / callback',
    description: 'Return visit for work we have already done. Kept separate so it is not invoiced as new work.',
    defaultPriority: 'P2',
    sortOrder: 120,
  },
  {
    code: 'RENTAL_SUPPLY',
    name: 'Equipment rental / supply-only',
    description: 'Parts or equipment supplied without a service visit.',
    defaultPriority: 'P4',
    sortOrder: 130,
  },
  {
    code: 'TRAINING',
    name: 'Training / familiarisation',
    description: 'Optional: operator or site-team familiarisation on a crane.',
    defaultPriority: 'P4',
    sortOrder: 140,
  },
]

// ---------------------------------------------------------------------------
// Shared field fragments
// ---------------------------------------------------------------------------

const passFailNa = (key: string, label: string, help?: string): TemplateField => ({
  key,
  label,
  type: 'PASS_FAIL_NA',
  required: true,
  ...(help ? { help } : {}),
})

const measurement = (key: string, label: string, unit: string, help?: string): TemplateField => ({
  key,
  label,
  type: 'NUMBER',
  unit,
  ...(help ? { help } : {}),
})

const narrative = (key: string, label: string, help?: string): TemplateField => ({
  key,
  label,
  type: 'TEXT',
  ...(help ? { help } : {}),
})

/** Every report ends with the question the customer actually cares about (§6.3). */
const safeToOperateSection: TemplateSchema['sections'][number] = {
  key: 'outcome',
  label: 'Outcome',
  layout: 'fields',
  fields: [
    {
      key: 'safeToOperate',
      label: 'Is the crane safe to operate?',
      type: 'RADIO',
      options: ['Yes', 'No', 'Yes, with restrictions'],
      required: true,
    },
    {
      key: 'restrictionDetail',
      label: 'If restricted or not safe, what is the restriction?',
      type: 'TEXT',
      help: 'This is what the customer is told and what the crane record should say.',
    },
    narrative('nextSteps', 'Next steps', 'Anything the office should quote or schedule next.'),
  ],
}

/** Findings are raised as rows, not prose, so they can become follow-up jobs (slice 9). */
const findingsSection: TemplateSchema['sections'][number] = {
  key: 'findings',
  label: 'Findings',
  layout: 'table',
  fields: [
    { key: 'component', label: 'Component', type: 'TEXT', required: true },
    { key: 'description', label: 'What is wrong', type: 'TEXT', required: true },
    {
      key: 'severity',
      label: 'Severity',
      type: 'RADIO',
      options: ['Critical', 'Major', 'Minor', 'Observation'],
      required: true,
    },
    { key: 'recommendation', label: 'Recommended action', type: 'TEXT' },
  ],
}

const workSummarySection: TemplateSchema['sections'][number] = {
  key: 'signOff',
  label: 'Sign-off',
  layout: 'fields',
  fields: [
    narrative('workSummary', 'Work done, briefly', 'What a reader of the report should take away.'),
  ],
}

// ---------------------------------------------------------------------------
// The four Phase 1 templates
// ---------------------------------------------------------------------------

export interface TemplateDefinition {
  key: TemplateKey
  /** Report template code, unique per version, e.g. SERVICING-v1. */
  code: string
  /**
   * The version this definition publishes. A template is immutable once published, so a wording or
   * field change is version 2 — the seed then points the job type at the newer row (slice 17).
   */
  version: 1 | 2
  name: string
  checklist: {
    code: string
    name: string
    items: ChecklistSeedItem[]
  }
  report: TemplateSchema
}

/** A checklist row as authored here; the seed turns it into a ChecklistItem row. */
export interface ChecklistSeedItem {
  section: string
  code: string
  label: string
  /** PASS_FAIL_NA | NUMBER | TEXT | YES_NO — the column is a string, not an enum. */
  resultType: 'PASS_FAIL_NA' | 'NUMBER' | 'TEXT' | 'YES_NO'
  unit?: string
  requiresMeasurement?: boolean
}

const servicingChecklist: ChecklistSeedItem[] = [
  // Hoist
  { section: 'Hoist', code: 'HOIST_OPERATION', label: 'Hoist raises and lowers smoothly under load', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'HOIST_BRAKE', label: 'Hoist brake holds the rated load with no slip', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'HOIST_DRUM_GROOVING', label: 'Rope drum and grooving condition', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'HOIST_GEARBOX_OIL', label: 'Gearbox oil level and condition', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'HOIST_NOISE_VIBRATION', label: 'Abnormal noise or vibration', resultType: 'YES_NO' },
  // Trolley
  { section: 'Trolley', code: 'TROLLEY_TRAVEL', label: 'Trolley travel and stopping distances', resultType: 'PASS_FAIL_NA' },
  { section: 'Trolley', code: 'TROLLEY_WHEELS', label: 'Trolley wheel and bearing condition', resultType: 'PASS_FAIL_NA' },
  { section: 'Trolley', code: 'TROLLEY_BUMPERS', label: 'End stops and bumpers present and sound', resultType: 'PASS_FAIL_NA' },
  // Bridge / boom
  { section: 'Bridge / boom', code: 'BRIDGE_TRAVEL', label: 'Bridge travel and stopping distances', resultType: 'PASS_FAIL_NA' },
  { section: 'Bridge / boom', code: 'BRIDGE_STRUCTURE', label: 'Structural members free of cracks, distortion or corrosion', resultType: 'PASS_FAIL_NA' },
  { section: 'Bridge / boom', code: 'BRIDGE_RAILS', label: 'Runway rails, alignment and fastenings', resultType: 'PASS_FAIL_NA' },
  // Brakes
  { section: 'Brakes', code: 'BRAKE_CONDITION', label: 'Brake linings and drums condition', resultType: 'PASS_FAIL_NA' },
  { section: 'Brakes', code: 'BRAKE_LINING_THICKNESS', label: 'Brake lining thickness', resultType: 'NUMBER', unit: 'mm', requiresMeasurement: true },
  { section: 'Brakes', code: 'BRAKE_AIR_GAP', label: 'Brake air gap', resultType: 'NUMBER', unit: 'mm', requiresMeasurement: true },
  // Wire rope
  { section: 'Wire rope', code: 'ROPE_CONDITION', label: 'Wire rope free of broken wires, kinks and corrosion', resultType: 'PASS_FAIL_NA' },
  { section: 'Wire rope', code: 'ROPE_DIAMETER', label: 'Wire rope diameter', resultType: 'NUMBER', unit: 'mm', requiresMeasurement: true },
  { section: 'Wire rope', code: 'ROPE_BROKEN_WIRES', label: 'Broken wires in the worst lay length', resultType: 'NUMBER', requiresMeasurement: true },
  { section: 'Wire rope', code: 'ROPE_WEAR', label: 'Visible wear or reduction from nominal diameter', resultType: 'PASS_FAIL_NA' },
  { section: 'Wire rope', code: 'ROPE_END_FITTINGS', label: 'Rope end fittings, wedge sockets and terminations', resultType: 'PASS_FAIL_NA' },
  // Hook and block
  { section: 'Hook and block', code: 'HOOK_THROAT_OPENING', label: 'Hook throat opening', resultType: 'NUMBER', unit: 'mm', requiresMeasurement: true },
  { section: 'Hook and block', code: 'HOOK_LATCH', label: 'Hook latch present, closes and is spring-loaded', resultType: 'PASS_FAIL_NA' },
  { section: 'Hook and block', code: 'HOOK_WEAR', label: 'Hook wear, twist or cracks', resultType: 'PASS_FAIL_NA' },
  { section: 'Hook and block', code: 'BLOCK_SHEAVES', label: 'Block sheaves and guards', resultType: 'PASS_FAIL_NA' },
  // Limit switches
  { section: 'Limit switches', code: 'LIMIT_HOIST_UPPER', label: 'Upper hoist limit stops the motion in time', resultType: 'PASS_FAIL_NA' },
  { section: 'Limit switches', code: 'LIMIT_HOIST_LOWER', label: 'Lower hoist limit', resultType: 'PASS_FAIL_NA' },
  { section: 'Limit switches', code: 'LIMIT_TRAVEL', label: 'Bridge and trolley travel limits', resultType: 'PASS_FAIL_NA' },
  { section: 'Limit switches', code: 'OVERLOAD_DEVICE', label: 'Overload protection operates (if fitted)', resultType: 'PASS_FAIL_NA' },
  // Controls and pendant
  { section: 'Controls / pendant', code: 'PENDANT_BUTTONS', label: 'Pendant or radio buttons return and are legible', resultType: 'PASS_FAIL_NA' },
  { section: 'Controls / pendant', code: 'PENDANT_CABLE', label: 'Pendant cable and strain relief', resultType: 'PASS_FAIL_NA' },
  { section: 'Controls / pendant', code: 'EMERGENCY_STOP', label: 'Emergency stop operates and is reachable', resultType: 'PASS_FAIL_NA' },
  { section: 'Controls / pendant', code: 'INDICATORS', label: 'Warning lights, horn and indicators', resultType: 'PASS_FAIL_NA' },
  // Electrical panel
  { section: 'Electrical panel', code: 'PANEL_CONDITION', label: 'Panel free of water, dust and rodent ingress', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical panel', code: 'PANEL_TERMINATIONS', label: 'Terminations tight, no discolouration', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical panel', code: 'PANEL_EARTHING', label: 'Earthing and bonding continuity', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical panel', code: 'PANEL_CONTACTORS', label: 'Contactors and overloads serviceable', resultType: 'PASS_FAIL_NA' },
  // Lubrication
  { section: 'Lubrication', code: 'LUBE_ROPE', label: 'Wire rope and sheaves lubricated', resultType: 'PASS_FAIL_NA' },
  { section: 'Lubrication', code: 'LUBE_GEARS', label: 'Gears, bearings and pivot points lubricated', resultType: 'PASS_FAIL_NA' },
  { section: 'Lubrication', code: 'LUBE_LEAKS', label: 'No unintended oil or grease leaks', resultType: 'PASS_FAIL_NA' },
]

const servicingReport: TemplateSchema = {
  checklistCode: 'SERVICING',
  sections: [
    {
      key: 'visit',
      label: 'Visit',
      layout: 'fields',
      fields: [
        { key: 'hourMeter', label: 'Hour meter reading', type: 'NUMBER', unit: 'h' },
        narrative('reasonForVisit', 'Why this visit happened', 'Scheduled service, or something the customer reported.'),
        narrative('workDone', 'Work carried out'),
        narrative('partsUsed', 'Parts used', 'Part numbers and quantities. Slice 8 links these to the stock movements.'),
      ],
    },
    {
      key: 'measurements',
      label: 'Measurements',
      layout: 'fields',
      fields: [
        measurement('brakeLiningMm', 'Brake lining thickness', 'mm'),
        measurement('brakeAirGapMm', 'Brake air gap', 'mm'),
        measurement('ropeDiameterMm', 'Wire rope diameter', 'mm'),
        measurement('brokenWires', 'Broken wires in the worst lay length', 'count'),
        measurement('hookThroatMm', 'Hook throat opening', 'mm'),
      ],
    },
    {
      key: 'defects',
      label: 'Defects and recommendations',
      layout: 'fields',
      fields: [
        narrative('defects', 'Defects found', 'Raise them as findings below if any need action.'),
        narrative('recommendations', 'Recommendations'),
      ],
    },
    findingsSection,
    safeToOperateSection,
    workSummarySection,
  ],
}

const breakdownReport: TemplateSchema = {
  checklistCode: 'BREAKDOWN',
  sections: [
    {
      key: 'timeline',
      label: 'Reported fault and timing',
      layout: 'fields',
      fields: [
        narrative('reportedFault', 'What the customer reported', 'Their words, as far as possible.'),
        { key: 'timeReported', label: 'Time reported', type: 'TEXT', help: 'Local time, e.g. 14:20.' },
        { key: 'timeArrived', label: 'Time arrived on site', type: 'TEXT' },
        { key: 'timeRestored', label: 'Time restored', type: 'TEXT', help: 'Leave blank if not restored.' },
      ],
    },
    {
      key: 'diagnosis',
      label: 'Diagnosis and repair',
      layout: 'fields',
      fields: [
        narrative('rootCause', 'Root cause'),
        narrative('correctiveAction', 'Corrective action taken'),
        narrative('temporaryMeasures', 'Temporary measures', 'Anything the customer must be told about operating limits.'),
      ],
    },
    {
      key: 'parts',
      label: 'Parts used',
      layout: 'table',
      fields: [
        { key: 'partNumber', label: 'Part number', type: 'TEXT', required: true },
        { key: 'description', label: 'Description', type: 'TEXT', required: true },
        { key: 'quantity', label: 'Quantity', type: 'NUMBER', required: true },
      ],
    },
    {
      key: 'status',
      label: 'Return to service',
      layout: 'fields',
      fields: [
        { key: 'returnedToService', label: 'Returned to service?', type: 'YES_NO', required: true },
        narrative('followUp', 'Recommended follow-up'),
      ],
    },
    findingsSection,
    safeToOperateSection,
    workSummarySection,
  ],
}

/**
 * Visual inspection, version 2 (slice 17). Version 1 had one line per component the brief names;
 * this one splits each category into the checks an inspector actually makes and adds the two the
 * brief asks for that were missing entirely — runway/rail condition and the state of the hoist rope's
 * drum and sheaves. Same components, same order, so a report's answers still line up by key.
 */
const visualInspectionReport: TemplateSchema = {
  checklistCode: 'VISUAL_INSPECTION',
  sections: [
    {
      key: 'structure',
      label: 'Structure',
      layout: 'fields',
      fields: [
        passFailNa('structureCondition', 'Structural members sound, no cracks or distortion'),
        passFailNa('corrosion', 'No significant corrosion or loose fasteners'),
        passFailNa('welds', 'Load-bearing welds visually sound'),
        passFailNa('runway', 'Runway beams, rails and end stops sound and aligned'),
        passFailNa('connections', 'Bolted and pinned connections tight, no movement'),
      ],
    },
    {
      key: 'safetyDevices',
      label: 'Safety devices',
      layout: 'fields',
      fields: [
        passFailNa('limitSwitches', 'Limit switches present and operating'),
        passFailNa('overload', 'Overload protection present and operating (if fitted)'),
        passFailNa('antiCollision', 'Anti-collision or travel limits where fitted'),
        passFailNa('emergencyStop', 'Emergency stop operates'),
        passFailNa('brakes', 'Hoist and travel brakes hold, no slip or drag'),
        passFailNa('guards', 'Guards, covers and access barriers in place'),
      ],
    },
    {
      key: 'markings',
      label: 'Markings and load charts',
      layout: 'fields',
      fields: [
        passFailNa('swlMarked', 'Safe working load marked and legible'),
        passFailNa('loadChart', 'Load chart present, legible and matches the rating'),
        passFailNa('registrationMarking', 'Registration or identification marking present'),
        passFailNa('warningLabels', 'Warning labels and operating instructions legible'),
      ],
    },
    {
      key: 'ropeAndHook',
      label: 'Wire rope and hook',
      layout: 'fields',
      fields: [
        passFailNa('ropeCondition', 'Wire rope free of broken wires, kinks and corrosion'),
        measurement('ropeDiameterMm', 'Wire rope diameter', 'mm'),
        passFailNa('ropeEndFittings', 'Rope end fittings, terminations and anchorage sound'),
        passFailNa('drumAndSheaves', 'Rope drum, sheaves and guards sound, rope sitting correctly'),
        passFailNa('hookCondition', 'Hook free of cracks, twist or excessive wear'),
        measurement('hookThroatMm', 'Hook throat opening', 'mm'),
        passFailNa('latch', 'Hook latch present and working'),
      ],
    },
    {
      key: 'controls',
      label: 'Operator controls',
      layout: 'fields',
      fields: [
        passFailNa('pendant', 'Pendant or radio controls serviceable'),
        passFailNa('indicators', 'Warning devices and indicators working'),
        narrative('controlsTested', 'Controls tested from the ground', 'Which motions were run, and from where.'),
      ],
    },
    {
      key: 'condition',
      label: 'Overall condition',
      layout: 'fields',
      fields: [
        {
          key: 'overallCondition',
          label: 'Overall condition rating',
          type: 'RADIO',
          options: ['Good', 'Fair', 'Poor'],
          required: true,
        },
        narrative('conditionNotes', 'Notes on the rating'),
      ],
    },
    findingsSection,
    safeToOperateSection,
    workSummarySection,
  ],
}

/**
 * Load test, version 2 (slice 17). Version 1 was published in slice 4 and already asked the
 * questions brief §6.3 names; what was missing was in the answers rather than the questions — a
 * radius with no unit, an instrument with no way to say whether it was a load cell or a weight, and
 * no place to put the deflection the examination looks for. Version 1 stays untouched so the reports
 * filled under it still render as issued; the seed points the job type at this one.
 */
const loadTestReport: TemplateSchema = {
  checklistCode: 'LOAD_TEST',
  sections: [
    {
      key: 'testSetup',
      label: 'Test setup',
      layout: 'fields',
      fields: [
        measurement('testLoadKg', 'Test load', 'kg'),
        { key: 'testDate', label: 'Date of test', type: 'DATE', required: true },
        narrative('testLocation', 'Where the test was carried out', 'Bay, radius and clearance as relevant.'),
        narrative('testMethod', 'Method', 'How the load was applied and held.'),
      ],
    },
    {
      key: 'instruments',
      label: 'Instruments used',
      layout: 'table',
      fields: [
        {
          key: 'instrumentType',
          label: 'Kind',
          type: 'RADIO',
          options: ['Load cell', 'Test weights', 'Other'],
          required: true,
        },
        { key: 'instrument', label: 'Load cell / test weight ID', type: 'TEXT', required: true },
        { key: 'serialNumber', label: 'Serial number', type: 'TEXT' },
        { key: 'calibrationDue', label: 'Calibration due', type: 'DATE' },
      ],
      minRows: 1,
      // Warnings only: brief §6.3 asks that expired calibration be flagged, not that the test be
      // refused. `calibrationWarnings` in src/lib/templates/schema.ts does the comparison.
      calibration: {
        testDateKey: 'testDate',
        labelKey: 'instrument',
        serialKey: 'serialNumber',
        dueKey: 'calibrationDue',
      },
    },
    {
      key: 'radii',
      label: 'Results at each radius',
      layout: 'table',
      fields: [
        { key: 'radiusM', label: 'Radius', type: 'NUMBER', unit: 'm', required: true },
        { key: 'swlKg', label: 'SWL at this radius', type: 'NUMBER', unit: 'kg', required: true },
        { key: 'testLoadKg', label: 'Test load applied', type: 'NUMBER', unit: 'kg', required: true },
        {
          key: 'result',
          label: 'Result at this point',
          type: 'RADIO',
          options: ['Pass', 'Fail'],
          required: true,
        },
      ],
      minRows: 1,
    },
    {
      key: 'examination',
      label: 'Examination',
      layout: 'fields',
      fields: [
        passFailNa('preTestExamination', 'Pre-test examination satisfactory'),
        passFailNa('postTestExamination', 'Post-test examination satisfactory'),
        measurement('deflectionMm', 'Maximum deflection observed', 'mm'),
        narrative('deflection', 'Deflection or abnormalities observed', 'What was deformed, sagged or moved, and where.'),
      ],
    },
    {
      key: 'authorisedExaminer',
      label: 'Authorised Examiner',
      layout: 'fields',
      fields: [
        { key: 'aeAttended', label: 'Did an Authorised Examiner attend?', type: 'YES_NO', required: true },
        narrative('aeName', 'AE name'),
        narrative('aeFirm', 'AE firm'),
        narrative(
          'statutoryNote',
          'Statutory position',
          'Our load test result is a company record. A statutory certificate is issued only by an Authorised Examiner.',
        ),
      ],
    },
    safeToOperateSection,
    findingsSection,
    workSummarySection,
  ],
}

export const TEMPLATES: readonly TemplateDefinition[] = [
  {
    key: 'SERVICING',
    code: 'SERVICING',
    version: 1,
    name: 'Scheduled servicing report',
    checklist: { code: 'SERVICING', name: 'Scheduled servicing checklist', items: servicingChecklist },
    report: servicingReport,
  },
  {
    key: 'BREAKDOWN',
    code: 'BREAKDOWN',
    version: 1,
    name: 'Breakdown report',
    checklist: {
      code: 'BREAKDOWN',
      name: 'Breakdown checklist',
      items: [
        { section: 'Response', code: 'SITE_ACCESS', label: 'Site accessed and crane isolated before work', resultType: 'PASS_FAIL_NA' },
        { section: 'Response', code: 'FAULT_CONFIRMED', label: 'Reported fault reproduced or confirmed', resultType: 'PASS_FAIL_NA' },
        { section: 'Response', code: 'PERMIT', label: 'Permit to work or induction completed if the site requires one', resultType: 'PASS_FAIL_NA' },
        { section: 'Repair', code: 'POWER_ISOLATED', label: 'Power isolated and locked off before repair', resultType: 'PASS_FAIL_NA' },
        { section: 'Repair', code: 'PARTS_AVAILABLE', label: 'Required parts available on site', resultType: 'YES_NO' },
        { section: 'Repair', code: 'FUNCTION_TEST', label: 'Function test after repair', resultType: 'PASS_FAIL_NA' },
        { section: 'Repair', code: 'LOAD_TEST_REQUIRED', label: 'Further load test or inspection required before use', resultType: 'YES_NO' },
        { section: 'Handover', code: 'AREA_CLEARED', label: 'Area cleared and guards refitted', resultType: 'PASS_FAIL_NA' },
        { section: 'Handover', code: 'CUSTOMER_BRIEFED', label: 'Customer representative briefed on the outcome', resultType: 'PASS_FAIL_NA' },
      ],
    },
    report: breakdownReport,
  },
  {
    key: 'VISUAL_INSPECTION',
    code: 'VISUAL_INSPECTION',
    version: 2,
    name: 'Visual inspection report',
    checklist: {
      code: 'VISUAL_INSPECTION',
      name: 'Visual inspection checklist',
      items: [
        { section: 'Structure', code: 'STRUCTURE', label: 'Structural members sound, no cracks or distortion', resultType: 'PASS_FAIL_NA' },
        { section: 'Structure', code: 'FASTENERS', label: 'Fasteners and pins secure', resultType: 'PASS_FAIL_NA' },
        { section: 'Structure', code: 'CORROSION', label: 'No significant corrosion', resultType: 'PASS_FAIL_NA' },
        { section: 'Safety', code: 'LIMITS', label: 'Limit switches present and operating', resultType: 'PASS_FAIL_NA' },
        { section: 'Safety', code: 'ESTOP', label: 'Emergency stop operates', resultType: 'PASS_FAIL_NA' },
        { section: 'Safety', code: 'GUARDS', label: 'Guards and covers in place', resultType: 'PASS_FAIL_NA' },
        { section: 'Markings', code: 'SWL', label: 'Safe working load marked and legible', resultType: 'PASS_FAIL_NA' },
        { section: 'Markings', code: 'LOAD_CHART', label: 'Load chart present and legible', resultType: 'PASS_FAIL_NA' },
        { section: 'Rope and hook', code: 'ROPE', label: 'Wire rope free of broken wires, kinks and corrosion', resultType: 'PASS_FAIL_NA' },
        { section: 'Rope and hook', code: 'HOOK', label: 'Hook free of cracks, twist or excessive wear', resultType: 'PASS_FAIL_NA' },
        { section: 'Rope and hook', code: 'LATCH', label: 'Hook latch present and working', resultType: 'PASS_FAIL_NA' },
        { section: 'Controls', code: 'PENDANT', label: 'Pendant or radio controls serviceable', resultType: 'PASS_FAIL_NA' },
      ],
    },
    report: visualInspectionReport,
  },
  {
    key: 'LOAD_TEST',
    code: 'LOAD_TEST',
    version: 2,
    name: 'Load test report',
    checklist: {
      code: 'LOAD_TEST',
      name: 'Load test checklist',
      items: [
        { section: 'Preparation', code: 'LOAD_CALCULATED', label: 'Test load calculated for each radius', resultType: 'PASS_FAIL_NA' },
        { section: 'Preparation', code: 'AREA_CLEARED', label: 'Test area cleared and exclusion zone set', resultType: 'PASS_FAIL_NA' },
        { section: 'Preparation', code: 'RIGGING_CHECKED', label: 'Rigging and slings inspected before use', resultType: 'PASS_FAIL_NA' },
        { section: 'Instruments', code: 'CALIBRATION_VALID', label: 'Load cell and test weights within calibration', resultType: 'PASS_FAIL_NA' },
        { section: 'Instruments', code: 'CALIBRATION_RECORDED', label: 'Instrument IDs and calibration dates recorded', resultType: 'PASS_FAIL_NA' },
        { section: 'Test', code: 'PRE_TEST', label: 'Pre-test structural examination satisfactory', resultType: 'PASS_FAIL_NA' },
        { section: 'Test', code: 'LOAD_APPLIED', label: 'Test load applied at each radius and held', resultType: 'PASS_FAIL_NA' },
        { section: 'Test', code: 'BRAKES_HELD', label: 'Brakes held the test load', resultType: 'PASS_FAIL_NA' },
        { section: 'Test', code: 'POST_TEST', label: 'Post-test examination found no defect', resultType: 'PASS_FAIL_NA' },
        { section: 'Test', code: 'PERMANENT_DEFORMATION', label: 'No permanent deformation or abnormal deflection', resultType: 'PASS_FAIL_NA' },
      ],
    },
    report: loadTestReport,
  },
]

// ---------------------------------------------------------------------------
// Crane and Monorail maintenance checklist (slice 46)
// ---------------------------------------------------------------------------

/**
 * A checklist the technicians carry on paper, seeded beside the four report templates because it has
 * no report of its own: the lines are graded on the phone and the job's Service Report turns them
 * into prose.
 *
 * Every line is `PASS_FAIL_NA`. The paper records a comment and a grade per line, not a measurement.
 * Codes carry the `CM_` prefix because the sync bundle dedupes checklist items by code alone and the
 * generic servicing sheet uses the same component names.
 */
export interface CraneChecklistDefinition {
  code: string
  name: string
  /** The job type whose default this sheet replaces, on the crane types it names. */
  jobTypeCode: string
  craneTypes: CraneType[]
  items: ChecklistSeedItem[]
}

const craneAndMonorailItems: ChecklistSeedItem[] = [
  // Item 1 — Hoist
  { section: 'Hoist', code: 'CM_HOIST_MAIN_MOTOR', label: 'Hoist main motor', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_MICRO_MOTOR', label: 'Hoist micro motor', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_BRAKE_LINING', label: 'Brake lining', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_BRAKE_RELAY', label: 'Brake relay / contactor', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_LIMIT_SWITCH', label: 'Limit switch', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_ROPE_GUIDE', label: 'Rope guide / chain guide', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_WIRE_ROPE', label: 'Wire rope / load chain', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_DRUM', label: 'Drum / chain box', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_SHEAVES', label: 'Rope sheaves / sprocket', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_BOTTOM_BLOCK', label: 'Bottom block / buffers', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_SAFETY_LATCH', label: 'Safety latch', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_FUSES', label: 'Fuses / breakers', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_CONTACTORS', label: 'Contactors', resultType: 'PASS_FAIL_NA' },
  { section: 'Hoist', code: 'CM_HOIST_INVERTER', label: 'Inverter / PLC', resultType: 'PASS_FAIL_NA' },
  // Item 2 — Cross travel
  { section: 'Cross travel', code: 'CM_CT_TRAVEL_MOTOR', label: 'Travel motor', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_BRAKE_LINING', label: 'Brake lining', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_MOUNTING', label: 'Mounting', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_TRAVEL_WHEELS', label: 'Travel wheels', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_RUBBER_BUFFERS', label: 'Rubber buffers', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_CONTACTORS', label: 'Contactors', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_INVERTER', label: 'Inverter', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_FUSES', label: 'Fuses / breaker', resultType: 'PASS_FAIL_NA' },
  { section: 'Cross travel', code: 'CM_CT_LIMIT_ANTI_COLLISION', label: 'Limit switch / anti-collision device', resultType: 'PASS_FAIL_NA' },
  // Item 3 — Long travel
  { section: 'Long travel', code: 'CM_LT_TRAVEL_MOTOR', label: 'Travel motor', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_BRAKE_LINING', label: 'Brake lining', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_MOUNTING', label: 'Mounting', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_TRAVEL_WHEELS', label: 'Travel wheels', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_RUBBER_BUFFERS', label: 'Rubber buffers', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_CONTACTORS', label: 'Contactors', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_INVERTER', label: 'Inverter', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_FUSES', label: 'Fuses / breaker', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_LIMIT_SWITCH', label: 'Limit switch', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_ANTI_COLLISION', label: 'Anti-collision device', resultType: 'PASS_FAIL_NA' },
  { section: 'Long travel', code: 'CM_LT_ALARM', label: 'Audio / visual alarm', resultType: 'PASS_FAIL_NA' },
  // Item 4 — Oil lubricants
  { section: 'Oil lubricants', code: 'CM_OIL_HOIST_GEARBOX', label: 'Hoisting gear box', resultType: 'PASS_FAIL_NA' },
  { section: 'Oil lubricants', code: 'CM_OIL_CT_GEARBOX', label: 'Cross travel gear box', resultType: 'PASS_FAIL_NA' },
  { section: 'Oil lubricants', code: 'CM_OIL_LT_GEARBOX', label: 'Long travel gear box', resultType: 'PASS_FAIL_NA' },
  { section: 'Oil lubricants', code: 'CM_OIL_WIRE_ROPE', label: 'Wire rope', resultType: 'PASS_FAIL_NA' },
  // Item 5 — Festoon
  { section: 'Festoon', code: 'CM_FES_POWER_CABLES', label: 'Power cables', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_MOBILE_CONTROL_CABLES', label: 'Mobile control cables', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_PENDANT', label: 'Push button pendant', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_CONTROL_ROUND_CABLE', label: 'Control round cable', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_C_TRACK', label: 'C track', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_CABLE_CARRIERS', label: 'Cable carriers', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_STRAINER_CORD', label: 'Carrier strainer cord', resultType: 'PASS_FAIL_NA' },
  { section: 'Festoon', code: 'CM_FES_REMOTE_CONTROL', label: 'Remote control', resultType: 'PASS_FAIL_NA' },
  // Item 6 — Electrical
  { section: 'Electrical', code: 'CM_ELEC_MAIN_CONTACTOR', label: 'Main contactor', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_OVERLOAD_DEVICE', label: 'Overload device', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_OPERATING_HOURS', label: 'Operating hours', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_LOAD_DISPLAY', label: 'Load display', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_PVC_POWER_CONDUCTOR', label: 'PVC power conductor', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_CURRENT_COLLECTOR', label: 'Current collector', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_CABLE_REEL', label: 'Cable reel', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_MAIN_BREAKER', label: 'Main breaker / fuses', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_CONTROL_VOLTAGE', label: 'Control voltage', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_PLC_UNIT', label: 'PLC unit', resultType: 'PASS_FAIL_NA' },
  { section: 'Electrical', code: 'CM_ELEC_TRANSFORMER', label: 'Transformer', resultType: 'PASS_FAIL_NA' },
]

export const CRANE_CHECKLISTS: readonly CraneChecklistDefinition[] = [
  {
    code: 'CRANE_AND_MONORAIL',
    name: 'Crane and monorail maintenance checklist',
    jobTypeCode: 'PM',
    craneTypes: ['OVERHEAD', 'GANTRY', 'JIB'],
    items: craneAndMonorailItems,
  },
]
