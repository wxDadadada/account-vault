import { type Subject } from './model'

export const subjectLabel = (value: string) => value.trim().toLowerCase()
export const subjectLabels = (subject: Subject) =>
  new Set([subject.name, ...subject.aliases].map(subjectLabel).filter(Boolean))

export function assertSubjectIdentity(subject: Subject, others: Subject[]) {
  if ([subject.name, ...subject.aliases].some((label) => !subjectLabel(label)))
    throw new Error(
      `主体「${subject.name}」的名称或别名不能为空白，请修改后重试`
    )
  const labels = subjectLabels(subject)
  const conflict = others.find(
    (other) =>
      other.id !== subject.id &&
      [...subjectLabels(other)].some((label) => labels.has(label))
  )
  if (conflict)
    throw new Error(
      `主体「${subject.name}」与「${conflict.name}」的名称或别名重复，请修改后重试`
    )
}

export function assertSubjectIdentities(subjects: Subject[]) {
  for (const subject of subjects) assertSubjectIdentity(subject, subjects)
}
