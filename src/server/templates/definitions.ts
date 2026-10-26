import type { Priority } from '@prisma/client'
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
      ],
    },
    {
      key: 'markings',
      label: 'Markings and load charts',
      layout: 'fields',
      fields: [
        passFailNa('swlMarked', 'Safe working load marked and legible'),
        passFailNa('loadChart', 'Load chart present and legible'),
        passFailNa('registrationMarking', 'Registration or identification marking present'),
      ],
    },
    {
      key: 'ropeAndHook',
      label: 'Wire rope and hook',
      layout: 'fields',
      fields: [
        passFailNa('ropeCondition', 'Wire rope free of broken wires, kinks and corrosion'),
        measurement('ropeDiameterMm', 'Wire rope diameter', 'mm'),
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
        { key: 'instrument', label: 'Load cell / test weight ID', type: 'TEXT', required: true },
        { key: 'serialNumber', label: 'Serial number', type: 'TEXT' },
        { key: 'calibrationDue', label: 'Calibration due', type: 'DATE' },
      ],
      minRows: 1,
    },
    {
      key: 'radii',
      label: 'Results at each radius',
      layout: 'table',
      fields: [
        { key: 'radiusM', label: 'Radius', type: 'NUMBER', required: true },
        { key: 'swlKg', label: 'SWL at this radius', type: 'NUMBER', required: true },
        { key: 'testLoadKg', label: 'Test load applied', type: 'NUMBER', required: true },
        {
          key: 'result',
          label: 'Result',
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
        narrative('deflection', 'Deflection or abnormalities observed'),
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
    name: 'Scheduled servicing report',
    checklist: { code: 'SERVICING', name: 'Scheduled servicing checklist', items: servicingChecklist },
    report: servicingReport,
  },
  {
    key: 'BREAKDOWN',
    code: 'BREAKDOWN',
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
