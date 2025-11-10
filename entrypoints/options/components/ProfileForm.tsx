import {
  ActionIcon,
  Button,
  Divider,
  FileInput,
  Group,
  Paper,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { Plus, Trash2 } from 'lucide-react';
import { FieldArrayPath, FieldPath, FieldPathValue, UseFormReturn, useFieldArray } from 'react-hook-form';
import type { ResumeExtractionResult } from '@/shared/types';

export interface ResumeFormValues {
  basics: {
    name: string;
    label: string;
    image: string;
    email: string;
    phone: string;
    url: string;
    summary: string;
    location: {
      address: string;
      postalCode: string;
      city: string;
      countryCode: string;
      region: string;
    };
    profiles: Array<{
      network: string;
      username: string;
      url: string;
    }>;
  };
  work: Array<{
    name: string;
    location: string;
    description: string;
    position: string;
    url: string;
    startDate: string;
    endDate: string;
    summary: string;
    highlights: string[];
  }>;
  volunteer: Array<{
    organization: string;
    position: string;
    url: string;
    startDate: string;
    endDate: string;
    summary: string;
    highlights: string[];
  }>;
  education: Array<{
    institution: string;
    url: string;
    area: string;
    studyType: string;
    startDate: string;
    endDate: string;
    score: string;
    courses: string[];
  }>;
  awards: Array<{
    title: string;
    date: string;
    awarder: string;
    summary: string;
  }>;
  certificates: Array<{
    name: string;
    date: string;
    url: string;
    issuer: string;
  }>;
  publications: Array<{
    name: string;
    publisher: string;
    releaseDate: string;
    url: string;
    summary: string;
  }>;
  skills: Array<{
    name: string;
    level: string;
    keywords: string[];
  }>;
  languages: Array<{
    language: string;
    fluency: string;
  }>;
  interests: Array<{
    name: string;
    keywords: string[];
  }>;
  references: Array<{
    name: string;
    reference: string;
  }>;
  projects: Array<{
    name: string;
    description: string;
    highlights: string[];
    keywords: string[];
    startDate: string;
    endDate: string;
    url: string;
    roles: string[];
    entity: string;
    type: string;
  }>;
  meta: {
    canonical: string;
    version: string;
    lastModified: string;
  };
}

export function createEmptyResumeFormValues(): ResumeFormValues {
  return {
    basics: {
      name: '',
      label: '',
      image: '',
      email: '',
      phone: '',
      url: '',
      summary: '',
      location: {
        address: '',
        postalCode: '',
        city: '',
        countryCode: '',
        region: '',
      },
      profiles: [],
    },
    work: [],
    volunteer: [],
    education: [],
    awards: [],
    certificates: [],
    publications: [],
    skills: [],
    languages: [],
    interests: [],
    references: [],
    projects: [],
    meta: {
      canonical: '',
      version: '',
      lastModified: '',
    },
  };
}

function createEmptyWorkEntry(): ResumeFormValues['work'][number] {
  return {
    name: '',
    location: '',
    description: '',
    position: '',
    url: '',
    startDate: '',
    endDate: '',
    summary: '',
    highlights: [],
  };
}

function createEmptyProfileLink(): ResumeFormValues['basics']['profiles'][number] {
  return {
    network: '',
    username: '',
    url: '',
  };
}

function createEmptyVolunteerEntry(): ResumeFormValues['volunteer'][number] {
  return {
    organization: '',
    position: '',
    url: '',
    startDate: '',
    endDate: '',
    summary: '',
    highlights: [],
  };
}

function createEmptyEducationEntry(): ResumeFormValues['education'][number] {
  return {
    institution: '',
    url: '',
    area: '',
    studyType: '',
    startDate: '',
    endDate: '',
    score: '',
    courses: [],
  };
}

function createEmptyAwardEntry(): ResumeFormValues['awards'][number] {
  return {
    title: '',
    date: '',
    awarder: '',
    summary: '',
  };
}

function createEmptyCertificateEntry(): ResumeFormValues['certificates'][number] {
  return {
    name: '',
    date: '',
    url: '',
    issuer: '',
  };
}

function createEmptyPublicationEntry(): ResumeFormValues['publications'][number] {
  return {
    name: '',
    publisher: '',
    releaseDate: '',
    url: '',
    summary: '',
  };
}

function createEmptySkillEntry(): ResumeFormValues['skills'][number] {
  return {
    name: '',
    level: '',
    keywords: [],
  };
}

function createEmptyLanguageEntry(): ResumeFormValues['languages'][number] {
  return {
    language: '',
    fluency: '',
  };
}

function createEmptyInterestEntry(): ResumeFormValues['interests'][number] {
  return {
    name: '',
    keywords: [],
  };
}

function createEmptyReferenceEntry(): ResumeFormValues['references'][number] {
  return {
    name: '',
    reference: '',
  };
}

function createEmptyProjectEntry(): ResumeFormValues['projects'][number] {
  return {
    name: '',
    description: '',
    highlights: [],
    keywords: [],
    startDate: '',
    endDate: '',
    url: '',
    roles: [],
    entity: '',
    type: '',
  };
}

type ArrayElement<T> = T extends Array<infer U> ? U : never;

function useResumeArrayField<TName extends FieldArrayPath<ResumeFormValues>>(
  form: UseFormReturn<ResumeFormValues>,
  name: TName,
) {
  const fieldArray = useFieldArray({
    control: form.control,
    name,
  });
  const watched = form.watch(name) as FieldPathValue<ResumeFormValues, TName> | undefined;
  const items = (watched ?? []) as FieldPathValue<ResumeFormValues, TName>;
  const append = (value: ArrayElement<FieldPathValue<ResumeFormValues, TName>>) =>
    fieldArray.append(value as never);
  const remove = fieldArray.remove;
  return { fields: fieldArray.fields, items, append, remove };
}

function setListValue<TName extends FieldPath<ResumeFormValues>>(
  form: UseFormReturn<ResumeFormValues>,
  name: TName,
  value: FieldPathValue<ResumeFormValues, TName>,
) {
  form.setValue(name, value, {
    shouldDirty: true,
    shouldTouch: true,
  });
}

interface ProfileFormProps {
  form: UseFormReturn<ResumeFormValues>;
  onSubmit: (values: ResumeFormValues) => void;
  onReset: () => void;
  disabled?: boolean;
  saving?: boolean;
  onFileSelect: (file: File | null) => void;
  onParseAgain?: () => void;
  parseAgainDisabled?: boolean;
  fileSummary?: string | null;
  rawSummary?: string | null;
  uploadInputId?: string;
}

export function ProfileForm({
  form,
  onSubmit,
  onReset,
  disabled = false,
  saving = false,
  onFileSelect,
  onParseAgain,
  parseAgainDisabled = false,
  fileSummary,
  rawSummary,
  uploadInputId = 'profile-form-upload',
}: ProfileFormProps) {
  const { t } = i18n;
  const translate = t as unknown as (key: string, substitutions?: unknown) => string;
  const { formState } = form;
  const { isDirty } = formState;

  return (
    <Paper withBorder radius="lg" p="lg" shadow="sm">
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <Stack gap="xl">
          <Stack gap={4}>
            <Text fw={600} fz="lg">
              {t('options.profileForm.heading')}
            </Text>
            <Text fz="sm" c="dimmed">
              {t('options.profileForm.description')}
            </Text>
          </Stack>

          <Stack gap="sm">
            <Text fw={600}>{t('options.profileForm.upload.heading')}</Text>
            <Group gap="sm" align="flex-end">
              <FileInput
                id={uploadInputId}
                radius="md"
                size="md"
                accept="application/pdf"
                onChange={onFileSelect}
                disabled={disabled}
                placeholder={t('options.profileForm.upload.placeholder')}
                style={{ flex: 1 }}
              />
              <Button
                type="button"
                variant="light"
                onClick={() => onParseAgain?.()}
                disabled={disabled || parseAgainDisabled || !onParseAgain}
              >
                {translate('options.profileForm.upload.parseAgain')}
              </Button>
            </Group>
            {fileSummary && (
              <Text fz="sm" c="dimmed">
                {fileSummary}
              </Text>
            )}
            {rawSummary && (
              <Text fz="sm" c="dimmed">
                {rawSummary}
              </Text>
            )}
          </Stack>

          <Divider label={t('options.profileForm.sections.basics')} labelPosition="left" />

          <BasicsSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.work')} labelPosition="left" />
          <WorkSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.volunteer')} labelPosition="left" />
          <VolunteerSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.education')} labelPosition="left" />
          <EducationSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.projects')} labelPosition="left" />
          <ProjectsSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.skills')} labelPosition="left" />
          <SkillsSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.awards')} labelPosition="left" />
          <AwardsSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.certificates')} labelPosition="left" />
          <CertificatesSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.publications')} labelPosition="left" />
          <PublicationsSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.languages')} labelPosition="left" />
          <LanguagesSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.interests')} labelPosition="left" />
          <InterestsSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.references')} labelPosition="left" />
          <ReferencesSection form={form} disabled={disabled} />

          <Divider label={t('options.profileForm.sections.meta')} labelPosition="left" />
          <MetaSection form={form} disabled={disabled} />

          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={onReset}
              disabled={disabled || !isDirty}
            >
              {t('options.profileForm.actions.reset')}
            </Button>
            <Button type="submit" disabled={disabled || !isDirty} loading={saving}>
              {saving ? t('options.profileForm.actions.saving') : t('options.profileForm.actions.save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}

interface SectionProps {
  form: UseFormReturn<ResumeFormValues>;
  disabled: boolean;
}

function BasicsSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const profilesArray = useResumeArrayField(form, 'basics.profiles');

  return (
    <Stack gap="md">
      <Group grow>
        <TextInput
          label={t('options.profileForm.basics.name')}
          placeholder={t('options.profileForm.basics.namePlaceholder')}
          disabled={disabled}
          {...form.register('basics.name')}
        />
        <TextInput
          label={t('options.profileForm.basics.label')}
          disabled={disabled}
          {...form.register('basics.label')}
        />
      </Group>

      <Group grow>
        <TextInput
          label={t('options.profileForm.basics.email')}
          disabled={disabled}
          {...form.register('basics.email')}
        />
        <TextInput
          label={t('options.profileForm.basics.phone')}
          disabled={disabled}
          {...form.register('basics.phone')}
        />
      </Group>

      <Group grow>
        <TextInput
          label={t('options.profileForm.basics.url')}
          disabled={disabled}
          {...form.register('basics.url')}
        />
        <TextInput
          label={t('options.profileForm.basics.image')}
          disabled={disabled}
          {...form.register('basics.image')}
        />
      </Group>

      <Textarea
        label={t('options.profileForm.basics.summary')}
        minRows={4}
        autosize
        disabled={disabled}
        {...form.register('basics.summary')}
      />

      <Stack gap={4}>
        <Text fz="sm" fw={600}>
          {t('options.profileForm.basics.location.heading')}
        </Text>
        <Group grow>
          <TextInput
            label={t('options.profileForm.basics.location.address')}
            disabled={disabled}
            {...form.register('basics.location.address')}
          />
          <TextInput
            label={t('options.profileForm.basics.location.city')}
            disabled={disabled}
            {...form.register('basics.location.city')}
          />
        </Group>
        <Group grow>
          <TextInput
            label={t('options.profileForm.basics.location.region')}
            disabled={disabled}
            {...form.register('basics.location.region')}
          />
          <TextInput
            label={t('options.profileForm.basics.location.countryCode')}
            disabled={disabled}
            {...form.register('basics.location.countryCode')}
          />
          <TextInput
            label={t('options.profileForm.basics.location.postalCode')}
            disabled={disabled}
            {...form.register('basics.location.postalCode')}
          />
        </Group>
      </Stack>

      <Stack gap="sm">
        <Group justify="space-between" align="center">
          <Text fz="sm" fw={600}>
            {t('options.profileForm.basics.profiles.heading')}
          </Text>
          <Button
            variant="light"
            leftSection={<Plus size={16} />}
            onClick={() => profilesArray.append(createEmptyProfileLink())}
            disabled={disabled}
          >
            {t('options.profileForm.basics.profiles.add')}
          </Button>
        </Group>
        <Stack gap="sm">
          {profilesArray.items.length === 0 && (
            <Text fz="sm" c="dimmed">
              {t('options.profileForm.basics.profiles.empty')}
            </Text>
          )}
          {profilesArray.fields.map((profileField, index) => (
            <Paper key={profileField.id} withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  <Text fw={600}>{t('options.profileForm.basics.profiles.item', [index + 1])}</Text>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => profilesArray.remove(index)}
                    disabled={disabled}
                    aria-label={t('options.profileForm.basics.profiles.remove')}
                  >
                    <Trash2 size={16} />
                  </ActionIcon>
                </Group>
                <Group grow>
                  <TextInput
                    label={t('options.profileForm.basics.profiles.network')}
                    disabled={disabled}
                    {...form.register(`basics.profiles.${index}.network` as const)}
                  />
                  <TextInput
                    label={t('options.profileForm.basics.profiles.username')}
                    disabled={disabled}
                    {...form.register(`basics.profiles.${index}.username` as const)}
                  />
                </Group>
                <TextInput
                  label={t('options.profileForm.basics.profiles.url')}
                  disabled={disabled}
                  {...form.register(`basics.profiles.${index}.url` as const)}
                />
              </Stack>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Stack>
  );
}

function WorkSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const workArray = useResumeArrayField(form, 'work');
  const workEntries = workArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.work.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => workArray.append(createEmptyWorkEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.work.add')}
        </Button>
      </Group>

      {workEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.work.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {workArray.fields.map((field, index) => {
          const entry = workEntries[index] ?? createEmptyWorkEntry();
          return (
            <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.work.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => workArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.work.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.work.name')}
                  disabled={disabled}
                  {...form.register(`work.${index}.name` as const)}
                />
                <TextInput
                  label={t('options.profileForm.work.position')}
                  disabled={disabled}
                  {...form.register(`work.${index}.position` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.work.location')}
                  disabled={disabled}
                  {...form.register(`work.${index}.location` as const)}
                />
                <TextInput
                  label={t('options.profileForm.work.url')}
                  disabled={disabled}
                  placeholder={t('options.profileForm.common.urlPlaceholder')}
                  {...form.register(`work.${index}.url` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.work.startDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`work.${index}.startDate` as const)}
                />
                <TextInput
                  label={t('options.profileForm.work.endDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`work.${index}.endDate` as const)}
                />
              </Group>

              <Textarea
                label={t('options.profileForm.work.description')}
                minRows={2}
                autosize
                disabled={disabled}
                {...form.register(`work.${index}.description` as const)}
              />

              <Textarea
                label={t('options.profileForm.work.summary')}
                minRows={3}
                autosize
                disabled={disabled}
                {...form.register(`work.${index}.summary` as const)}
              />

              <MultilineListInput
                label={t('options.profileForm.work.highlights')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.highlights ?? []}
                disabled={disabled}
                onChange={(value) => setListValue(form, `work.${index}.highlights` as const, value)}
              />
            </Stack>
          </Paper>
        );
        })}
      </Stack>
    </Stack>
  );
}

function VolunteerSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const volunteerArray = useResumeArrayField(form, 'volunteer');
  const volunteerEntries = volunteerArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.volunteer.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => volunteerArray.append(createEmptyVolunteerEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.volunteer.add')}
        </Button>
      </Group>

      {volunteerEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.volunteer.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {volunteerArray.fields.map((field, index) => {
          const entry = volunteerEntries[index] ?? createEmptyVolunteerEntry();
          return (
            <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.volunteer.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => volunteerArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.volunteer.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.volunteer.organization')}
                  disabled={disabled}
                  {...form.register(`volunteer.${index}.organization` as const)}
                />
                <TextInput
                  label={t('options.profileForm.volunteer.position')}
                  disabled={disabled}
                  {...form.register(`volunteer.${index}.position` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.volunteer.url')}
                  placeholder={t('options.profileForm.common.urlPlaceholder')}
                  disabled={disabled}
                  {...form.register(`volunteer.${index}.url` as const)}
                />
                <TextInput
                  label={t('options.profileForm.volunteer.startDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`volunteer.${index}.startDate` as const)}
                />
                <TextInput
                  label={t('options.profileForm.volunteer.endDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`volunteer.${index}.endDate` as const)}
                />
              </Group>

              <Textarea
                label={t('options.profileForm.volunteer.summary')}
                minRows={3}
                autosize
                disabled={disabled}
                {...form.register(`volunteer.${index}.summary` as const)}
              />

              <MultilineListInput
                label={t('options.profileForm.volunteer.highlights')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.highlights ?? []}
                disabled={disabled}
                onChange={(value) =>
                  setListValue(form, `volunteer.${index}.highlights` as const, value)
                }
              />
            </Stack>
          </Paper>
        );
        })}
      </Stack>
    </Stack>
  );
}

function EducationSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const educationArray = useResumeArrayField(form, 'education');
  const educationEntries = educationArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.education.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => educationArray.append(createEmptyEducationEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.education.add')}
        </Button>
      </Group>

      {educationEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.education.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {educationArray.fields.map((field, index) => {
          const entry = educationEntries[index] ?? createEmptyEducationEntry();
          return (
            <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.education.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => educationArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.education.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.education.institution')}
                  disabled={disabled}
                  {...form.register(`education.${index}.institution` as const)}
                />
                <TextInput
                  label={t('options.profileForm.education.url')}
                  placeholder={t('options.profileForm.common.urlPlaceholder')}
                  disabled={disabled}
                  {...form.register(`education.${index}.url` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.education.area')}
                  disabled={disabled}
                  {...form.register(`education.${index}.area` as const)}
                />
                <TextInput
                  label={t('options.profileForm.education.studyType')}
                  disabled={disabled}
                  {...form.register(`education.${index}.studyType` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.education.startDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`education.${index}.startDate` as const)}
                />
                <TextInput
                  label={t('options.profileForm.education.endDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`education.${index}.endDate` as const)}
                />
                <TextInput
                  label={t('options.profileForm.education.score')}
                  disabled={disabled}
                  {...form.register(`education.${index}.score` as const)}
                />
              </Group>

              <MultilineListInput
                label={t('options.profileForm.education.courses')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.courses ?? []}
                disabled={disabled}
                onChange={(value) =>
                  setListValue(form, `education.${index}.courses` as const, value)
                }
              />
            </Stack>
          </Paper>
        );
        })}
      </Stack>
    </Stack>
  );
}

function ProjectsSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const projectsArray = useResumeArrayField(form, 'projects');
  const projectsEntries = projectsArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.projects.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => projectsArray.append(createEmptyProjectEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.projects.add')}
        </Button>
      </Group>

      {projectsEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.projects.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {projectsArray.fields.map((field, index) => {
          const entry = projectsEntries[index] ?? createEmptyProjectEntry();
          return (
            <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.projects.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => projectsArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.projects.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.projects.name')}
                  disabled={disabled}
                  {...form.register(`projects.${index}.name` as const)}
                />
                <TextInput
                  label={t('options.profileForm.projects.entity')}
                  disabled={disabled}
                  {...form.register(`projects.${index}.entity` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.projects.type')}
                  disabled={disabled}
                  {...form.register(`projects.${index}.type` as const)}
                />
                <TextInput
                  label={t('options.profileForm.projects.url')}
                  placeholder={t('options.profileForm.common.urlPlaceholder')}
                  disabled={disabled}
                  {...form.register(`projects.${index}.url` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.projects.startDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`projects.${index}.startDate` as const)}
                />
                <TextInput
                  label={t('options.profileForm.projects.endDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`projects.${index}.endDate` as const)}
                />
              </Group>

              <Textarea
                label={t('options.profileForm.projects.description')}
                minRows={3}
                autosize
                disabled={disabled}
                {...form.register(`projects.${index}.description` as const)}
              />

              <MultilineListInput
                label={t('options.profileForm.projects.roles')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.roles ?? []}
                disabled={disabled}
                onChange={(value) => setListValue(form, `projects.${index}.roles` as const, value)}
              />

              <MultilineListInput
                label={t('options.profileForm.projects.highlights')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.highlights ?? []}
                disabled={disabled}
                onChange={(value) =>
                  setListValue(form, `projects.${index}.highlights` as const, value)
                }
              />

              <MultilineListInput
                label={t('options.profileForm.projects.keywords')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.keywords ?? []}
                disabled={disabled}
                onChange={(value) =>
                  setListValue(form, `projects.${index}.keywords` as const, value)
                }
              />
            </Stack>
          </Paper>
        );
        })}
      </Stack>
    </Stack>
  );
}

function SkillsSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const skillsArray = useResumeArrayField(form, 'skills');
  const skillsEntries = skillsArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.skills.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => skillsArray.append(createEmptySkillEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.skills.add')}
        </Button>
      </Group>

      {skillsEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.skills.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {skillsArray.fields.map((field, index) => {
          const entry = skillsEntries[index] ?? createEmptySkillEntry();
          return (
            <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.skills.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => skillsArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.skills.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.skills.name')}
                  disabled={disabled}
                  {...form.register(`skills.${index}.name` as const)}
                />
                <TextInput
                  label={t('options.profileForm.skills.level')}
                  disabled={disabled}
                  {...form.register(`skills.${index}.level` as const)}
                />
              </Group>

              <MultilineListInput
                label={t('options.profileForm.skills.keywords')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.keywords ?? []}
                disabled={disabled}
                onChange={(value) =>
                  setListValue(form, `skills.${index}.keywords` as const, value)
                }
              />
            </Stack>
          </Paper>
        );
        })}
      </Stack>
    </Stack>
  );
}

function AwardsSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const awardsArray = useResumeArrayField(form, 'awards');
  const awardsEntries = awardsArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.awards.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => awardsArray.append(createEmptyAwardEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.awards.add')}
        </Button>
      </Group>

      {awardsEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.awards.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {awardsArray.fields.map((field, index) => (
          <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.awards.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => awardsArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.awards.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.awards.title')}
                  disabled={disabled}
                  {...form.register(`awards.${index}.title` as const)}
                />
                <TextInput
                  label={t('options.profileForm.awards.awarder')}
                  disabled={disabled}
                  {...form.register(`awards.${index}.awarder` as const)}
                />
              </Group>

              <TextInput
                label={t('options.profileForm.awards.date')}
                placeholder={t('options.profileForm.common.datePlaceholder')}
                disabled={disabled}
                {...form.register(`awards.${index}.date` as const)}
              />

              <Textarea
                label={t('options.profileForm.awards.summary')}
                minRows={2}
                autosize
                disabled={disabled}
                {...form.register(`awards.${index}.summary` as const)}
              />
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function CertificatesSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const certificatesArray = useResumeArrayField(form, 'certificates');
  const certificatesEntries = certificatesArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.certificates.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => certificatesArray.append(createEmptyCertificateEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.certificates.add')}
        </Button>
      </Group>

      {certificatesEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.certificates.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {certificatesArray.fields.map((field, index) => (
          <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.certificates.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => certificatesArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.certificates.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.certificates.name')}
                  disabled={disabled}
                  {...form.register(`certificates.${index}.name` as const)}
                />
                <TextInput
                  label={t('options.profileForm.certificates.issuer')}
                  disabled={disabled}
                  {...form.register(`certificates.${index}.issuer` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.certificates.date')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`certificates.${index}.date` as const)}
                />
                <TextInput
                  label={t('options.profileForm.certificates.url')}
                  placeholder={t('options.profileForm.common.urlPlaceholder')}
                  disabled={disabled}
                  {...form.register(`certificates.${index}.url` as const)}
                />
              </Group>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function PublicationsSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const publicationsArray = useResumeArrayField(form, 'publications');
  const publicationsEntries = publicationsArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.publications.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => publicationsArray.append(createEmptyPublicationEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.publications.add')}
        </Button>
      </Group>

      {publicationsEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.publications.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {publicationsArray.fields.map((field, index) => (
          <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.publications.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => publicationsArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.publications.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.publications.name')}
                  disabled={disabled}
                  {...form.register(`publications.${index}.name` as const)}
                />
                <TextInput
                  label={t('options.profileForm.publications.publisher')}
                  disabled={disabled}
                  {...form.register(`publications.${index}.publisher` as const)}
                />
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.publications.releaseDate')}
                  placeholder={t('options.profileForm.common.datePlaceholder')}
                  disabled={disabled}
                  {...form.register(`publications.${index}.releaseDate` as const)}
                />
                <TextInput
                  label={t('options.profileForm.publications.url')}
                  placeholder={t('options.profileForm.common.urlPlaceholder')}
                  disabled={disabled}
                  {...form.register(`publications.${index}.url` as const)}
                />
              </Group>

              <Textarea
                label={t('options.profileForm.publications.summary')}
                minRows={3}
                autosize
                disabled={disabled}
                {...form.register(`publications.${index}.summary` as const)}
              />
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function LanguagesSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const languagesArray = useResumeArrayField(form, 'languages');
  const languagesEntries = languagesArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.languages.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => languagesArray.append(createEmptyLanguageEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.languages.add')}
        </Button>
      </Group>

      {languagesEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.languages.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {languagesArray.fields.map((field, index) => (
          <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.languages.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => languagesArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.languages.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <Group grow>
                <TextInput
                  label={t('options.profileForm.languages.language')}
                  disabled={disabled}
                  {...form.register(`languages.${index}.language` as const)}
                />
                <TextInput
                  label={t('options.profileForm.languages.fluency')}
                  disabled={disabled}
                  {...form.register(`languages.${index}.fluency` as const)}
                />
              </Group>
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function InterestsSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const interestsArray = useResumeArrayField(form, 'interests');
  const interestsEntries = interestsArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.interests.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => interestsArray.append(createEmptyInterestEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.interests.add')}
        </Button>
      </Group>

      {interestsEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.interests.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {interestsArray.fields.map((field, index) => {
          const entry = interestsEntries[index] ?? createEmptyInterestEntry();
          return (
            <Paper key={field.id} withBorder radius="md" p="md">
              <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.interests.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => interestsArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.interests.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <TextInput
                label={t('options.profileForm.interests.name')}
                disabled={disabled}
                {...form.register(`interests.${index}.name` as const)}
              />

              <MultilineListInput
                label={t('options.profileForm.interests.keywords')}
                placeholder={t('options.profileForm.common.listPlaceholder')}
                value={entry.keywords ?? []}
                disabled={disabled}
                onChange={(value) =>
                  setListValue(form, `interests.${index}.keywords` as const, value)
                }
              />
            </Stack>
          </Paper>
        );
        })}
      </Stack>
    </Stack>
  );
}

function ReferencesSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  const referencesArray = useResumeArrayField(form, 'references');
  const referencesEntries = referencesArray.items;

  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Text fz="sm" fw={600}>
          {t('options.profileForm.references.heading')}
        </Text>
        <Button
          variant="light"
          leftSection={<Plus size={16} />}
          onClick={() => referencesArray.append(createEmptyReferenceEntry())}
          disabled={disabled}
        >
          {t('options.profileForm.references.add')}
        </Button>
      </Group>

      {referencesEntries.length === 0 && (
        <Text fz="sm" c="dimmed">
          {t('options.profileForm.references.empty')}
        </Text>
      )}

      <Stack gap="sm">
        {referencesArray.fields.map((field, index) => (
          <Paper key={field.id} withBorder radius="md" p="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{t('options.profileForm.references.item', [index + 1])}</Text>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => referencesArray.remove(index)}
                  disabled={disabled}
                  aria-label={t('options.profileForm.references.remove')}
                >
                  <Trash2 size={16} />
                </ActionIcon>
              </Group>

              <TextInput
                label={t('options.profileForm.references.name')}
                disabled={disabled}
                {...form.register(`references.${index}.name` as const)}
              />

              <Textarea
                label={t('options.profileForm.references.reference')}
                minRows={2}
                autosize
                disabled={disabled}
                {...form.register(`references.${index}.reference` as const)}
              />
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

function MetaSection({ form, disabled }: SectionProps) {
  const { t } = i18n;
  return (
    <Stack gap="md">
      <TextInput
        label={t('options.profileForm.meta.canonical')}
        placeholder={t('options.profileForm.common.urlPlaceholder')}
        disabled={disabled}
        {...form.register('meta.canonical')}
      />
      <TextInput
        label={t('options.profileForm.meta.version')}
        disabled={disabled}
        {...form.register('meta.version')}
      />
      <TextInput
        label={t('options.profileForm.meta.lastModified')}
        placeholder={t('options.profileForm.common.datePlaceholder')}
        disabled={disabled}
        {...form.register('meta.lastModified')}
      />
    </Stack>
  );
}

interface MultilineListInputProps {
  label: string;
  placeholder?: string;
  value: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
  minRows?: number;
}

function MultilineListInput({
  label,
  placeholder,
  value,
  disabled,
  onChange,
  minRows = 3,
}: MultilineListInputProps) {
  return (
    <Textarea
      label={label}
      placeholder={placeholder}
      disabled={disabled}
      autosize
      minRows={minRows}
      value={value.join('\n')}
      onChange={(event) => onChange(splitMultiline(event.currentTarget.value))}
    />
  );
}

export function resumeToFormValues(source: unknown): ResumeFormValues {
  const base = createEmptyResumeFormValues();
  if (!isPlainObject(source)) {
    return base;
  }

  const resume = source as Record<string, unknown>;

  if (isPlainObject(resume.basics)) {
    const basics = resume.basics as Record<string, unknown>;
    base.basics.name = readString(basics.name);
    base.basics.label = readString(basics.label);
    base.basics.image = readString(basics.image);
    base.basics.email = readString(basics.email);
    base.basics.phone = readString(basics.phone);
    base.basics.url = readString(basics.url);
    base.basics.summary = readString(basics.summary);

    if (isPlainObject(basics.location)) {
      const location = basics.location as Record<string, unknown>;
      base.basics.location.address = readString(location.address);
      base.basics.location.postalCode = readString(location.postalCode);
      base.basics.location.city = readString(location.city);
      base.basics.location.countryCode = readString(location.countryCode);
      base.basics.location.region = readString(location.region);
    }

    if (Array.isArray(basics.profiles)) {
      base.basics.profiles = basics.profiles
        .map((item) =>
          isPlainObject(item)
            ? {
                network: readString((item as Record<string, unknown>).network),
                username: readString((item as Record<string, unknown>).username),
                url: readString((item as Record<string, unknown>).url),
              }
            : null,
        )
        .filter((item): item is ResumeFormValues['basics']['profiles'][number] =>
          hasAnyValue(item?.network ?? '', item?.username ?? '', item?.url ?? ''),
        );
    }
  }

  base.work = parseSectionArray(resume.work, parseWorkEntry);
  base.volunteer = parseSectionArray(resume.volunteer, parseVolunteerEntry);
  base.education = parseSectionArray(resume.education, parseEducationEntry);
  base.awards = parseSectionArray(resume.awards, parseAwardEntry);
  base.certificates = parseSectionArray(resume.certificates, parseCertificateEntry);
  base.publications = parseSectionArray(resume.publications, parsePublicationEntry);
  base.skills = parseSectionArray(resume.skills, parseSkillEntry);
  base.languages = parseSectionArray(resume.languages, parseLanguageEntry);
  base.interests = parseSectionArray(resume.interests, parseInterestEntry);
  base.references = parseSectionArray(resume.references, parseReferenceEntry);
  base.projects = parseSectionArray(resume.projects, parseProjectEntry);

  if (isPlainObject(resume.meta)) {
    const meta = resume.meta as Record<string, unknown>;
    base.meta.canonical = readString(meta.canonical);
    base.meta.version = readString(meta.version);
    base.meta.lastModified = readString(meta.lastModified);
  }

  return base;
}

export function formValuesToResume(values: ResumeFormValues): ResumeExtractionResult {
  const resume: ResumeExtractionResult = {};
  const basics: Record<string, unknown> = {};

  assignIf(basics, 'name', values.basics.name);
  assignIf(basics, 'label', values.basics.label);
  assignIf(basics, 'image', values.basics.image);
  assignIf(basics, 'email', values.basics.email);
  assignIf(basics, 'phone', values.basics.phone);
  assignIf(basics, 'url', values.basics.url);
  assignIf(basics, 'summary', values.basics.summary);

  const location: Record<string, unknown> = {};
  assignIf(location, 'address', values.basics.location.address);
  assignIf(location, 'postalCode', values.basics.location.postalCode);
  assignIf(location, 'city', values.basics.location.city);
  assignIf(location, 'countryCode', values.basics.location.countryCode);
  assignIf(location, 'region', values.basics.location.region);
  if (Object.keys(location).length > 0) {
    basics.location = location;
  }

  const profiles = mapSection(values.basics.profiles, (item) => {
    const profile: Record<string, unknown> = {};
    assignIf(profile, 'network', item.network);
    assignIf(profile, 'username', item.username);
    assignIf(profile, 'url', item.url);
    return profile;
  });
  if (profiles.length > 0) {
    basics.profiles = profiles;
  }

  if (Object.keys(basics).length > 0) {
    resume.basics = basics;
  }

  const work = mapSection(values.work, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignIf(entry, 'location', item.location);
    assignIf(entry, 'description', item.description);
    assignIf(entry, 'position', item.position);
    assignIf(entry, 'url', item.url);
    assignIf(entry, 'startDate', item.startDate);
    assignIf(entry, 'endDate', item.endDate);
    assignIf(entry, 'summary', item.summary);
    assignArrayIf(entry, 'highlights', item.highlights);
    return entry;
  });
  if (work.length > 0) {
    resume.work = work;
  }

  const volunteer = mapSection(values.volunteer, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'organization', item.organization);
    assignIf(entry, 'position', item.position);
    assignIf(entry, 'url', item.url);
    assignIf(entry, 'startDate', item.startDate);
    assignIf(entry, 'endDate', item.endDate);
    assignIf(entry, 'summary', item.summary);
    assignArrayIf(entry, 'highlights', item.highlights);
    return entry;
  });
  if (volunteer.length > 0) {
    resume.volunteer = volunteer;
  }

  const education = mapSection(values.education, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'institution', item.institution);
    assignIf(entry, 'url', item.url);
    assignIf(entry, 'area', item.area);
    assignIf(entry, 'studyType', item.studyType);
    assignIf(entry, 'startDate', item.startDate);
    assignIf(entry, 'endDate', item.endDate);
    assignIf(entry, 'score', item.score);
    assignArrayIf(entry, 'courses', item.courses);
    return entry;
  });
  if (education.length > 0) {
    resume.education = education;
  }

  const awards = mapSection(values.awards, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'title', item.title);
    assignIf(entry, 'date', item.date);
    assignIf(entry, 'awarder', item.awarder);
    assignIf(entry, 'summary', item.summary);
    return entry;
  });
  if (awards.length > 0) {
    resume.awards = awards;
  }

  const certificates = mapSection(values.certificates, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignIf(entry, 'date', item.date);
    assignIf(entry, 'url', item.url);
    assignIf(entry, 'issuer', item.issuer);
    return entry;
  });
  if (certificates.length > 0) {
    resume.certificates = certificates;
  }

  const publications = mapSection(values.publications, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignIf(entry, 'publisher', item.publisher);
    assignIf(entry, 'releaseDate', item.releaseDate);
    assignIf(entry, 'url', item.url);
    assignIf(entry, 'summary', item.summary);
    return entry;
  });
  if (publications.length > 0) {
    resume.publications = publications;
  }

  const skills = mapSection(values.skills, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignIf(entry, 'level', item.level);
    assignArrayIf(entry, 'keywords', item.keywords);
    return entry;
  });
  if (skills.length > 0) {
    resume.skills = skills;
  }

  const languages = mapSection(values.languages, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'language', item.language);
    assignIf(entry, 'fluency', item.fluency);
    return entry;
  });
  if (languages.length > 0) {
    resume.languages = languages;
  }

  const interests = mapSection(values.interests, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignArrayIf(entry, 'keywords', item.keywords);
    return entry;
  });
  if (interests.length > 0) {
    resume.interests = interests;
  }

  const references = mapSection(values.references, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignIf(entry, 'reference', item.reference);
    return entry;
  });
  if (references.length > 0) {
    resume.references = references;
  }

  const projects = mapSection(values.projects, (item) => {
    const entry: Record<string, unknown> = {};
    assignIf(entry, 'name', item.name);
    assignIf(entry, 'description', item.description);
    assignArrayIf(entry, 'highlights', item.highlights);
    assignArrayIf(entry, 'keywords', item.keywords);
    assignIf(entry, 'startDate', item.startDate);
    assignIf(entry, 'endDate', item.endDate);
    assignIf(entry, 'url', item.url);
    assignArrayIf(entry, 'roles', item.roles);
    assignIf(entry, 'entity', item.entity);
    assignIf(entry, 'type', item.type);
    return entry;
  });
  if (projects.length > 0) {
    resume.projects = projects;
  }

  const meta: Record<string, unknown> = {};
  assignIf(meta, 'canonical', values.meta.canonical);
  assignIf(meta, 'version', values.meta.version);
  assignIf(meta, 'lastModified', values.meta.lastModified);
  if (Object.keys(meta).length > 0) {
    resume.meta = meta;
  }

  return resume;
}

export function mergeResumeFormValues(
  current: ResumeFormValues,
  incoming: ResumeFormValues,
): ResumeFormValues {
  return {
    basics: {
      name: preferString(current.basics.name, incoming.basics.name),
      label: preferString(current.basics.label, incoming.basics.label),
      image: preferString(current.basics.image, incoming.basics.image),
      email: preferString(current.basics.email, incoming.basics.email),
      phone: preferString(current.basics.phone, incoming.basics.phone),
      url: preferString(current.basics.url, incoming.basics.url),
      summary: preferString(current.basics.summary, incoming.basics.summary),
      location: {
        address: preferString(current.basics.location.address, incoming.basics.location.address),
        postalCode: preferString(
          current.basics.location.postalCode,
          incoming.basics.location.postalCode,
        ),
        city: preferString(current.basics.location.city, incoming.basics.location.city),
        countryCode: preferString(
          current.basics.location.countryCode,
          incoming.basics.location.countryCode,
        ),
        region: preferString(current.basics.location.region, incoming.basics.location.region),
      },
      profiles:
        incoming.basics.profiles.length > 0 ? incoming.basics.profiles : current.basics.profiles,
    },
    work: preferArray(current.work, incoming.work),
    volunteer: preferArray(current.volunteer, incoming.volunteer),
    education: preferArray(current.education, incoming.education),
    awards: preferArray(current.awards, incoming.awards),
    certificates: preferArray(current.certificates, incoming.certificates),
    publications: preferArray(current.publications, incoming.publications),
    skills: preferArray(current.skills, incoming.skills),
    languages: preferArray(current.languages, incoming.languages),
    interests: preferArray(current.interests, incoming.interests),
    references: preferArray(current.references, incoming.references),
    projects: preferArray(current.projects, incoming.projects),
    meta: {
      canonical: preferString(current.meta.canonical, incoming.meta.canonical),
      version: preferString(current.meta.version, incoming.meta.version),
      lastModified: preferString(current.meta.lastModified, incoming.meta.lastModified),
    },
  };
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0);
}

function splitMultiline(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function normalizeStringArray(value: string[]): string[] {
  return value
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function assignIf(target: Record<string, unknown>, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    target[key] = trimmed;
  }
}

function assignArrayIf(target: Record<string, unknown>, key: string, value: string[]) {
  const normalized = normalizeStringArray(value);
  if (normalized.length > 0) {
    target[key] = normalized;
  }
}

function mapSection<T>(
  items: T[],
  builder: (item: T) => Record<string, unknown>,
): Record<string, unknown>[] {
  return items
    .map((item) => {
      const built = builder(item);
      return Object.keys(built).length > 0 ? built : null;
    })
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function hasAnyValue(...values: Array<string | string[]>): boolean {
  return values.some((value) => {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return value.trim().length > 0;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseSectionArray<T>(
  source: unknown,
  parser: (item: Record<string, unknown>) => T | null,
): T[] {
  if (!Array.isArray(source)) {
    return [];
  }
  return source
    .map((item) => (isPlainObject(item) ? parser(item as Record<string, unknown>) : null))
    .filter((item): item is T => Boolean(item));
}

function preferString(current: string, incoming: string): string {
  return hasStringValue(incoming) ? incoming : current;
}

function preferArray<T>(current: T[], incoming: T[]): T[] {
  return incoming.length > 0 ? incoming : current;
}

function hasStringValue(value: string): boolean {
  return value.trim().length > 0;
}

function parseWorkEntry(source: Record<string, unknown>): ResumeFormValues['work'][number] | null {
  const entry = {
    name: readString(source.name),
    location: readString(source.location),
    description: readString(source.description),
    position: readString(source.position),
    url: readString(source.url),
    startDate: readString(source.startDate),
    endDate: readString(source.endDate),
    summary: readString(source.summary),
    highlights: readStringArray(source.highlights),
  };
  return hasAnyValue(
    entry.name,
    entry.location,
    entry.description,
    entry.position,
    entry.url,
    entry.startDate,
    entry.endDate,
    entry.summary,
    entry.highlights,
  )
    ? entry
    : null;
}

function parseVolunteerEntry(
  source: Record<string, unknown>,
): ResumeFormValues['volunteer'][number] | null {
  const entry = {
    organization: readString(source.organization),
    position: readString(source.position),
    url: readString(source.url),
    startDate: readString(source.startDate),
    endDate: readString(source.endDate),
    summary: readString(source.summary),
    highlights: readStringArray(source.highlights),
  };
  return hasAnyValue(
    entry.organization,
    entry.position,
    entry.url,
    entry.startDate,
    entry.endDate,
    entry.summary,
    entry.highlights,
  )
    ? entry
    : null;
}

function parseEducationEntry(
  source: Record<string, unknown>,
): ResumeFormValues['education'][number] | null {
  const entry = {
    institution: readString(source.institution),
    url: readString(source.url),
    area: readString(source.area),
    studyType: readString(source.studyType),
    startDate: readString(source.startDate),
    endDate: readString(source.endDate),
    score: readString(source.score),
    courses: readStringArray(source.courses),
  };
  return hasAnyValue(
    entry.institution,
    entry.url,
    entry.area,
    entry.studyType,
    entry.startDate,
    entry.endDate,
    entry.score,
    entry.courses,
  )
    ? entry
    : null;
}

function parseAwardEntry(source: Record<string, unknown>): ResumeFormValues['awards'][number] | null {
  const entry = {
    title: readString(source.title),
    date: readString(source.date),
    awarder: readString(source.awarder),
    summary: readString(source.summary),
  };
  return hasAnyValue(entry.title, entry.date, entry.awarder, entry.summary) ? entry : null;
}

function parseCertificateEntry(
  source: Record<string, unknown>,
): ResumeFormValues['certificates'][number] | null {
  const entry = {
    name: readString(source.name),
    date: readString(source.date),
    url: readString(source.url),
    issuer: readString(source.issuer),
  };
  return hasAnyValue(entry.name, entry.date, entry.url, entry.issuer) ? entry : null;
}

function parsePublicationEntry(
  source: Record<string, unknown>,
): ResumeFormValues['publications'][number] | null {
  const entry = {
    name: readString(source.name),
    publisher: readString(source.publisher),
    releaseDate: readString(source.releaseDate),
    url: readString(source.url),
    summary: readString(source.summary),
  };
  return hasAnyValue(entry.name, entry.publisher, entry.releaseDate, entry.url, entry.summary)
    ? entry
    : null;
}

function parseSkillEntry(source: Record<string, unknown>): ResumeFormValues['skills'][number] | null {
  const entry = {
    name: readString(source.name),
    level: readString(source.level),
    keywords: readStringArray(source.keywords),
  };
  return hasAnyValue(entry.name, entry.level, entry.keywords) ? entry : null;
}

function parseLanguageEntry(
  source: Record<string, unknown>,
): ResumeFormValues['languages'][number] | null {
  const entry = {
    language: readString(source.language),
    fluency: readString(source.fluency),
  };
  return hasAnyValue(entry.language, entry.fluency) ? entry : null;
}

function parseInterestEntry(
  source: Record<string, unknown>,
): ResumeFormValues['interests'][number] | null {
  const entry = {
    name: readString(source.name),
    keywords: readStringArray(source.keywords),
  };
  return hasAnyValue(entry.name, entry.keywords) ? entry : null;
}

function parseReferenceEntry(
  source: Record<string, unknown>,
): ResumeFormValues['references'][number] | null {
  const entry = {
    name: readString(source.name),
    reference: readString(source.reference),
  };
  return hasAnyValue(entry.name, entry.reference) ? entry : null;
}

function parseProjectEntry(
  source: Record<string, unknown>,
): ResumeFormValues['projects'][number] | null {
  const entry = {
    name: readString(source.name),
    description: readString(source.description),
    highlights: readStringArray(source.highlights),
    keywords: readStringArray(source.keywords),
    startDate: readString(source.startDate),
    endDate: readString(source.endDate),
    url: readString(source.url),
    roles: readStringArray(source.roles),
    entity: readString(source.entity),
    type: readString(source.type),
  };
  return hasAnyValue(
    entry.name,
    entry.description,
    entry.highlights,
    entry.keywords,
    entry.startDate,
    entry.endDate,
    entry.url,
    entry.roles,
    entry.entity,
    entry.type,
  )
    ? entry
    : null;
}
