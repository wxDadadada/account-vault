import { type Dispatch, type SetStateAction } from 'react'
import { KeyRound, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { draftFor, patchDraft, type Draft } from '../lib/ai-conversation'
import { type Account, type VaultData } from '../lib/model'
import { FieldSelect, FieldOption } from './controls'
import { Field, PasswordField, TextField } from './fields'

export function AIDraftReview({
  drafts,
  setDrafts,
  currentData,
  defaultSubject,
}: {
  drafts: Draft[]
  setDrafts: Dispatch<SetStateAction<Draft[]>>
  currentData: VaultData
  defaultSubject: string
}) {
  const patch = (id: string, values: Partial<Account>) =>
    setDrafts((ds) =>
      ds.map((d) => (d.id === id ? patchDraft(d, values, currentData) : d))
    )
  return (
    <div className='ai-drafts'>
      {drafts.map((d, index) => (
        <section className='ai-draft' key={d.id}>
          <div className='ai-draft-heading'>
            <span>
              <KeyRound size={17} />
              账号 {index + 1}
              <small>
                {d.original
                  ? '更新已有账号'
                  : d.needsTarget
                    ? '请选择更新目标'
                    : '新建账号'}
              </small>
            </span>
            <Button
              variant='ghost'
              size='icon'
              aria-label={`移除第 ${index + 1} 张卡片`}
              onClick={() =>
                setDrafts(drafts.filter((item) => item.id !== d.id))
              }
            >
              <X size={17} />
            </Button>
          </div>
          {d.item.action === 'update' && (
            <Field label='要更新的已有账号'>
              <FieldSelect
                aria-label={`第 ${index + 1} 张卡片的更新目标`}
                value={d.original?.id ?? ''}
                onValueChange={(selectedValue) => {
                  const target = currentData.accounts.find(
                    (a) => a.id === selectedValue
                  )
                  if (target)
                    setDrafts((ds) =>
                      ds!.map((v) =>
                        v.id === d.id
                          ? {
                              ...draftFor(
                                d.item,
                                currentData,
                                defaultSubject,
                                target,
                                d
                              ),
                              id: d.id,
                            }
                          : v
                      )
                    )
                }}
              >
                <FieldOption value=''>请选择账号，避免更新错记录</FieldOption>
                {currentData.accounts.map((a) => (
                  <FieldOption key={a.id} value={a.id}>
                    {a.platform} · {a.username} ·{' '}
                    {currentData.subjects.find((s) => s.id === a.subjectId)
                      ?.name ?? '未分配'}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
          )}
          <div className='form-grid'>
            <TextField
              label='平台 *'
              value={d.account.platform}
              onChange={(e) => patch(d.id, { platform: e.target.value })}
              maxLength={200}
            />
            <TextField
              label='账号 *'
              value={d.account.username}
              onChange={(e) => patch(d.id, { username: e.target.value })}
              maxLength={320}
            />
          </div>
          <div className='form-grid'>
            <Field label='所属主体'>
              <FieldSelect
                aria-label={`账号 ${index + 1} 所属主体`}
                value={
                  d.subjectConfirmed ? d.account.subjectId : '__unconfirmed__'
                }
                onValueChange={(selectedValue) =>
                  patch(d.id, { subjectId: selectedValue })
                }
              >
                {!d.subjectConfirmed && (
                  <FieldOption value='__unconfirmed__' disabled>
                    请选择所属主体
                  </FieldOption>
                )}
                <FieldOption value=''>暂不分配</FieldOption>
                {currentData.subjects.map((s) => (
                  <FieldOption key={s.id} value={s.id}>
                    {s.name}
                  </FieldOption>
                ))}
                <FieldOption value='__new__'>新建主体</FieldOption>
              </FieldSelect>
            </Field>
            <Field label='分类'>
              <FieldSelect
                aria-label={`账号 ${index + 1} 分类`}
                value={d.account.category}
                onValueChange={(selectedValue) =>
                  patch(d.id, { category: selectedValue })
                }
              >
                {[
                  ...new Set([...currentData.categories, d.account.category]),
                ].map((c) => (
                  <FieldOption value={c} key={c}>
                    {c}
                  </FieldOption>
                ))}
              </FieldSelect>
            </Field>
          </div>
          {d.account.subjectId === '__new__' && (
            <TextField
              label='新主体名称'
              value={d.subjectName}
              onChange={(e) =>
                setDrafts((ds) =>
                  ds!.map((v) =>
                    v.id === d.id
                      ? {
                          ...v,
                          subjectName: e.target.value,
                          subjectConfirmed: true,
                          item: { ...v.item, subject: e.target.value },
                        }
                      : v
                  )
                )
              }
              maxLength={200}
            />
          )}
          <PasswordField
            label='密码（安全字段）'
            value={d.account.password}
            onChange={(password) => patch(d.id, { password })}
            generate
          />
          <div className='form-grid'>
            <TextField
              label='绑定邮箱'
              value={d.account.email}
              onChange={(e) => patch(d.id, { email: e.target.value })}
              maxLength={320}
            />
            <TextField
              label='绑定手机'
              value={d.account.phone}
              onChange={(e) => patch(d.id, { phone: e.target.value })}
              maxLength={64}
            />
          </div>
          <TextField
            label='登录地址'
            value={d.account.url}
            onChange={(e) => patch(d.id, { url: e.target.value })}
            maxLength={2048}
          />
          <Field label='标签'>
            <Input
              aria-label={`账号 ${index + 1} 标签`}
              value={d.account.tags.join('，')}
              onChange={(e) =>
                patch(d.id, { tags: e.target.value.split(/[,，]/) })
              }
            />
          </Field>
          <TextField
            label='备注'
            value={d.account.notes}
            onChange={(e) => patch(d.id, { notes: e.target.value })}
            maxLength={4000}
          />
          <div className='form-grid'>
            <TextField
              label='登录方式'
              value={d.account.loginMethod}
              onChange={(e) => patch(d.id, { loginMethod: e.target.value })}
              maxLength={100}
            />
            <Field label='状态'>
              <FieldSelect
                aria-label={`账号 ${index + 1} 状态`}
                value={d.account.status}
                onValueChange={(selectedValue) =>
                  patch(d.id, {
                    status: selectedValue as Account['status'],
                  })
                }
              >
                <FieldOption value='active'>使用中</FieldOption>
                <FieldOption value='inactive'>已停用</FieldOption>
                <FieldOption value='pending'>待完善</FieldOption>
              </FieldSelect>
            </Field>
          </div>
        </section>
      ))}
    </div>
  )
}
