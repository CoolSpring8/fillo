import type { ScannedField } from './types';
import type { FieldSlot } from './slotTypes';
import { resolveSlotFromAutocomplete, resolveSlotFromLabel, resolveSlotFromText } from './slots';

export function resolveFieldSlot(field: ScannedField, adapterIds: string[]): FieldSlot | null {
  const context = (field.context ?? '').toLowerCase();
  const label = field.label.toLowerCase();

  const hasContext = (token: string | string[]) => {
    const tokens = Array.isArray(token) ? token : [token];
    return tokens.some((entry) => context.includes(entry));
  };
  const hasLabel = (token: string | string[]) => {
    const tokens = Array.isArray(token) ? token : [token];
    return tokens.some((entry) => label.includes(entry));
  };
  const contextIncludesAll = (tokens: string[]) => tokens.every((entry) => context.includes(entry));

  const byAutocomplete = resolveSlotFromAutocomplete(field.autocomplete);
  if (byAutocomplete) {
    return byAutocomplete;
  }
  const byLabel = resolveSlotFromLabel(field.label, adapterIds);
  if (byLabel) {
    return byLabel;
  }
  const byAdaptersContext = resolveSlotFromText(field.context, adapterIds);
  if (byAdaptersContext) {
    return byAdaptersContext;
  }
  if (hasContext(['email', 'e-mail'])) return 'email';
  if (hasContext(['phone', 'mobile', 'telephone'])) return 'phone';
  if (hasContext(['address', 'street address'])) return 'address';
  if (hasContext(['postal code', 'zip'])) return 'postalCode';
  if (hasContext(['state', 'province', 'region'])) return 'state';
  if (hasContext(['date of birth', 'birth date', 'dob', 'birthday'])) return 'birthDate';
  if (hasContext(['gender', 'sex'])) return 'gender';
  if (hasContext(['current company', 'employer']) || hasLabel(['current company', 'employer'])) return 'currentCompany';
  if (hasContext(['current title', 'job title', 'position']) || hasLabel(['job title', 'position'])) return 'currentTitle';
  if (hasContext(['current location', 'work location'])) return 'currentLocation';
  if (contextIncludesAll(['employment', 'start']) || hasContext(['employment start', 'work start'])) return 'currentStartDate';
  if (contextIncludesAll(['employment', 'end']) || hasContext(['employment end', 'work end', 'last day'])) return 'currentEndDate';
  if (hasContext(['school', 'university', 'college', 'institution'])) return 'educationSchool';
  if (hasContext(['degree', 'qualification', 'study type'])) return 'educationDegree';
  if (hasContext(['major', 'field of study', 'discipline'])) return 'educationField';
  if (hasContext(['enrollment', 'education start'])) return 'educationStartDate';
  if (hasContext(['graduation', 'completion'])) return 'educationEndDate';
  if (hasContext(['gpa', 'grade point', 'grade'])) return 'educationGpa';
  if (hasContext(['expected salary', 'desired salary', 'salary expectation'])) return 'expectedSalary';
  if (hasContext(['preferred location', 'desired location', 'target location'])) return 'preferredLocation';
  if (hasContext(['availability', 'available from', 'available date'])) return 'availabilityDate';
  if (hasContext(['employment type', 'job type'])) return 'jobType';
  if (hasContext(['skill'])) return 'skills';

  if (field.kind === 'email') return 'email';
  if (field.kind === 'tel') return 'phone';
  if (field.kind === 'textarea') return 'summary';
  if (field.kind === 'text' && (hasLabel('linkedin') || hasContext('linkedin'))) return 'linkedin';
  if (field.kind === 'text' && (hasLabel('github') || hasContext('github'))) return 'github';
  if (field.kind === 'text' && (hasLabel(['website', 'portfolio']) || hasContext(['website', 'portfolio']))) return 'website';
  if (hasContext(['linkedin'])) return 'linkedin';
  if (hasContext(['github'])) return 'github';
  if (hasContext(['website', 'portfolio'])) return 'website';
  if (hasContext(['summary', 'about', 'bio'])) return 'summary';
  if (hasContext(['headline', 'current role', 'title'])) return 'headline';
  if (hasContext(['city', 'town'])) return 'city';
  if (hasContext(['country'])) return 'country';
  if (hasContext(['first name', 'given name'])) return 'firstName';
  if (hasContext(['last name', 'family name', 'surname'])) return 'lastName';
  if (hasContext(['full name', 'name'])) return 'name';

  return null;
}
