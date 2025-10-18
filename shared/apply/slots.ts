export type FieldSlot =
  | 'name'
  | 'firstName'
  | 'lastName'
  | 'email'
  | 'phone'
  | 'city'
  | 'country'
  | 'state'
  | 'postalCode'
  | 'address'
  | 'birthDate'
  | 'gender'
  | 'website'
  | 'linkedin'
  | 'github'
  | 'summary'
  | 'headline'
  | 'currentCompany'
  | 'currentTitle'
  | 'currentLocation'
  | 'currentStartDate'
  | 'currentEndDate'
  | 'educationSchool'
  | 'educationDegree'
  | 'educationField'
  | 'educationStartDate'
  | 'educationEndDate'
  | 'educationGpa'
  | 'expectedSalary'
  | 'preferredLocation'
  | 'availabilityDate'
  | 'jobType'
  | 'skills';

const slotSynonyms: Record<FieldSlot, RegExp[]> = {
  name: [/^name$/, /^full\s*name$/i, /^your\s*name$/i],
  firstName: [/^first\s*name$/i, /^given[-\s]?name$/i],
  lastName: [/^last\s*name$/i, /^family[-\s]?name$/i, /^surname$/i],
  email: [/^e[-\s]?mail$/i, /^email\s*address$/i],
  phone: [/^phone/i, /^mobile$/i, /^telephone$/i],
  city: [/^city$/i, /^town$/i],
  country: [/^country$/i],
  state: [/^state$/i, /^province$/i, /^region$/i],
  postalCode: [/^postal\s*code$/i, /^zip$/i, /^zip\s*code$/i],
  address: [/^address$/i, /^street$/i, /^street\s*address$/i],
  birthDate: [/^date\s*of\s*birth$/i, /^birth\s*date$/i, /^dob$/i, /^birthday$/i],
  gender: [/^gender$/i, /^sex$/i],
  website: [/^website$/i, /^portfolio$/i, /^personal\s*site$/i],
  linkedin: [/^linkedin/i],
  github: [/^github/i],
  summary: [/^summary$/i, /^about\s+you$/i, /^bio$/i],
  headline: [/^headline$/i, /^current\s*role$/i, /^title$/i],
  currentCompany: [/^current\s*company$/i, /^employer$/i, /^organization$/i, /^company$/i],
  currentTitle: [/^current\s*(title|position)$/i, /^job\s*title$/i, /^role$/i],
  currentLocation: [/^current\s*location$/i, /^work\s*location$/i, /^office\s*location$/i],
  currentStartDate: [/^current\s*(employment|job)?\s*start/i, /^employment\s*start$/i, /^work\s*start$/i],
  currentEndDate: [/^current\s*(employment|job)?\s*end/i, /^employment\s*end$/i, /^work\s*end$/i, /^last\s*day$/i],
  educationSchool: [/^school$/i, /^university$/i, /^college$/i, /^institution$/i],
  educationDegree: [/^degree$/i, /^education\s*level$/i, /^qualification$/i],
  educationField: [/^major$/i, /^field\s*of\s*study$/i, /^discipline$/i],
  educationStartDate: [/^enrollment\s*date$/i, /^education\s*start$/i],
  educationEndDate: [/^graduation\s*date$/i, /^education\s*end$/i, /^completion\s*date$/i],
  educationGpa: [/^gpa$/i, /^grade$/i, /^grade\s*point$/i],
  expectedSalary: [/^expected\s*salary$/i, /^desired\s*salary$/i, /^salary\s*expectation$/i],
  preferredLocation: [/^preferred\s*location$/i, /^desired\s*location$/i, /^target\s*location$/i],
  availabilityDate: [/^availability$/i, /^available\s*from$/i, /^available\s*date$/i],
  jobType: [/^job\s*type$/i, /^employment\s*type$/i],
  skills: [/^skills$/i, /^skill\s*set$/i],
};

export function resolveSlotFromLabel(label: string): FieldSlot | null {
  const normalized = label.trim().toLowerCase();
  for (const [slot, patterns] of Object.entries(slotSynonyms) as [FieldSlot, RegExp[]][]) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      return slot;
    }
  }
  return null;
}

export function resolveSlotFromAutocomplete(token: string | undefined): FieldSlot | null {
  if (!token) {
    return null;
  }

  const value = token.toLowerCase();
  if (value.includes('email')) return 'email';
  if (value.includes('given-name')) return 'firstName';
  if (value.includes('additional-name')) return 'name';
  if (value.includes('family-name')) return 'lastName';
  if (value.includes('tel')) return 'phone';
  if (value.includes('address-level2')) return 'city';
  if (value.includes('country')) return 'country';
  if (value.includes('address-level1')) return 'state';
  if (value.includes('postal') || value.includes('zip')) return 'postalCode';
  if (value.includes('street-address')) return 'address';
  if (value.includes('organization-title')) return 'currentTitle';
  if (value.includes('organization')) return 'currentCompany';
  if (value.includes('bday')) return 'birthDate';
  if (value.includes('sex')) return 'gender';
  if (value.includes('url')) return 'website';
  return null;
}
