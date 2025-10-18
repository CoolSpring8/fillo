import type { GeneratedI18nStructure } from '#i18n';
import type { FieldSlot } from './slotTypes';

type ZeroSubstitutionKey = {
  [K in keyof GeneratedI18nStructure]: GeneratedI18nStructure[K]['substitutions'] extends 0 ? K : never;
}[keyof GeneratedI18nStructure];

export interface FieldLabelAdapter {
  id: string;
  nameKey: ZeroSubstitutionKey;
  descriptionKey?: ZeroSubstitutionKey;
  matchers: Partial<Record<FieldSlot, RegExp[]>>;
}

const EN_MATCHERS: Partial<Record<FieldSlot, RegExp[]>> = {
  name: [/^name$/i, /^full\s*name$/i, /^your\s*name$/i],
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

const ZH_CN_MATCHERS: Partial<Record<FieldSlot, RegExp[]>> = {
  name: [/姓名/, /真实姓名/, /名字/],
  lastName: [/姓$/, /姓氏/],
  email: [/邮箱/, /电子邮件/],
  phone: [/电话/, /手机/, /联系电话/],
  city: [/城市/, /所在城市/, /市$/],
  country: [/国家/, /国籍/],
  state: [/省/, /省份/, /州/],
  postalCode: [/邮编/, /邮政编码/],
  address: [/地址/, /通讯地址/, /联系地址/, /详细地址/],
  birthDate: [/出生日期/, /出生年月/, /生日/, /出生时间/],
  gender: [/性别/],
  website: [/网站/, /主页/, /网址/],
  linkedin: [/领英/],
  github: [/github/i],
  summary: [/自我介绍/, /个人简介/, /自我评价/],
  headline: [/当前职位/, /现任职位/, /职称/, /头衔/],
  currentCompany: [/现单位/, /现公司/, /所在公司/, /工作单位/],
  currentTitle: [/职位/, /岗位/, /职务/, /职称/],
  currentLocation: [/工作地点/, /现居地/, /所在地点/, /办公地点/],
  currentStartDate: [/入职日期/, /开始日期/, /入职时间/, /工作开始时间/],
  currentEndDate: [/离职日期/, /结束日期/, /离职时间/, /工作结束时间/],
  educationSchool: [/学校/, /毕业院校/, /院校/],
  educationDegree: [/学历/, /学位/],
  educationField: [/专业/, /研究方向/, /学习方向/],
  educationStartDate: [/入学日期/, /入学时间/, /学习开始时间/],
  educationEndDate: [/毕业日期/, /毕业时间/, /结束时间/],
  educationGpa: [/绩点/, /gpa/i, /平均分/],
  expectedSalary: [/期望薪资/, /薪资要求/, /期望工资/, /期望薪水/],
  preferredLocation: [/期望地点/, /意向城市/, /期望工作地点/, /目标城市/],
  availabilityDate: [/到岗时间/, /可入职时间/, /可用时间/],
  jobType: [/工作性质/, /工作类型/, /职位类型/, /工作方式/],
  skills: [/技能/, /技能特长/, /技术栈/, /擅长领域/],
};

const DEFAULT_ADAPTERS: FieldLabelAdapter[] = [
  {
    id: 'en_default',
    nameKey: 'adapters.items.en_default.name',
    descriptionKey: 'adapters.items.en_default.description',
    matchers: EN_MATCHERS,
  },
  {
    id: 'zh_cn',
    nameKey: 'adapters.items.zh_cn.name',
    descriptionKey: 'adapters.items.zh_cn.description',
    matchers: ZH_CN_MATCHERS,
  },
];

export function getLabelAdapters(selectedIds?: string[]): FieldLabelAdapter[] {
  if (!selectedIds || selectedIds.length === 0) {
    return DEFAULT_ADAPTERS;
  }
  const set = new Set(selectedIds);
  const filtered = DEFAULT_ADAPTERS.filter((adapter) => set.has(adapter.id));
  return filtered.length > 0 ? filtered : DEFAULT_ADAPTERS;
}

export function matchSlotWithAdapters(text: string, adapterIds?: string[]): FieldSlot | null {
  const normalizedVariants = buildVariants(text);
  if (normalizedVariants.length === 0) {
    return null;
  }
  const adapters = getLabelAdapters(adapterIds);
  for (const adapter of adapters) {
    for (const [slot, patterns] of Object.entries(adapter.matchers) as [FieldSlot, RegExp[]][]) {
      if (!patterns || patterns.length === 0) {
        continue;
      }
      for (const variant of normalizedVariants) {
        if (patterns.some((pattern) => pattern.test(variant))) {
          return slot;
        }
      }
    }
  }
  return null;
}

function buildVariants(input: string): string[] {
  if (!input || typeof input !== 'string') {
    return [];
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }
  const stripped = trimmed
    .replace(/[：:]/g, ' ')
    .replace(/[（）()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = stripped.toLowerCase();
  return Array.from(new Set([trimmed, stripped, lower]));
}

export function listAvailableAdapters(): FieldLabelAdapter[] {
  return DEFAULT_ADAPTERS;
}
