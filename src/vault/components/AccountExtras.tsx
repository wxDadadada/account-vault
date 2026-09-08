import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { type Account } from '../lib/model'
import { Disclosure, FieldOption, FieldSelect } from './controls'
import { Field, PasswordField, TextField } from './fields'

export function AccountExtras({
  account,
  onChange,
}: {
  account: Account
  onChange: (patch: Partial<Account>) => void
}) {
  const fields = account.customFields ?? []
  function updateField(id: string, patch: Partial<(typeof fields)[number]>) {
    onChange({
      customFields: fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })
  }
  return (
    <>
      <Disclosure title='到期与提醒' defaultOpen={!!account.expiresOn}>
        <div className='advanced-content'>
          <div className='form-grid'>
            <TextField
              label='到期日期'
              type='date'
              value={account.expiresOn ?? ''}
              onChange={(e) => onChange({ expiresOn: e.target.value })}
            />
            <Field label='提前提醒'>
              <FieldSelect
                aria-label='提前提醒天数'
                value={String(account.reminderDays ?? 7)}
                onValueChange={(v) => onChange({ reminderDays: Number(v) })}
              >
                {[
                  ...new Set([
                    0,
                    1,
                    3,
                    7,
                    14,
                    30,
                    90,
                    account.reminderDays ?? 7,
                  ]),
                ]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <FieldOption key={n} value={String(n)}>
                      {n === 0 ? '到期当天' : `提前 ${n} 天`}
                    </FieldOption>
                  ))}
              </FieldSelect>
            </Field>
          </div>
          <p className='field-hint'>
            适用于订阅、证书或凭据有效期。打开并解锁账号库时显示提醒；续期后更新日期，停用账号不再提醒。
          </p>
        </div>
      </Disclosure>
      <Disclosure title='账号验证码（TOTP）' defaultOpen={!!account.totp}>
        <div className='advanced-content'>
          <PasswordField
            label='验证码密钥'
            value={account.totp ?? ''}
            onChange={(totp) => onChange({ totp })}
            placeholder='Base32 密钥或 otpauth://totp/…'
          />
          <p className='field-hint'>
            保存平台提供的设置密钥，支持 6／8
            位验证码。在详情中本地生成并复制，与账号一起加密；请保留平台的恢复方式。
          </p>
        </div>
      </Disclosure>
      <Disclosure
        key={fields.length ? 'has-fields' : 'no-fields'}
        title={'自定义字段' + (fields.length ? ` · ${fields.length}` : '')}
        defaultOpen={fields.length > 0}
      >
        <div className='advanced-content custom-field-editor'>
          {fields.map((field, index) => (
            <div className='custom-field-edit-row' key={field.id}>
              <div className='custom-field-label-row'>
                <TextField
                  label={`字段 ${index + 1} 名称`}
                  value={field.label}
                  onChange={(e) =>
                    updateField(field.id, { label: e.target.value })
                  }
                  maxLength={200}
                  required
                  placeholder='例如：API Token'
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  aria-label={`移除字段 ${index + 1}`}
                  onClick={() =>
                    onChange({
                      customFields: fields.filter((f) => f.id !== field.id),
                    })
                  }
                >
                  <Trash2 size={16} />
                </Button>
              </div>
              {field.secret ? (
                <PasswordField
                  label={`字段 ${index + 1} 内容`}
                  value={field.value}
                  onChange={(value) => updateField(field.id, { value })}
                />
              ) : (
                <TextField
                  label={`字段 ${index + 1} 内容`}
                  value={field.value}
                  onChange={(e) =>
                    updateField(field.id, { value: e.target.value })
                  }
                  maxLength={4096}
                  autoComplete='off'
                />
              )}
              <label className='checkbox-row'>
                <Checkbox
                  checked={field.secret}
                  onCheckedChange={(v) =>
                    updateField(field.id, { secret: v === true })
                  }
                />
                敏感内容，默认隐藏
              </label>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            disabled={fields.length >= 30}
            onClick={() =>
              onChange({
                customFields: [
                  ...fields,
                  {
                    id: crypto.randomUUID(),
                    label: '',
                    value: '',
                    secret: true,
                  },
                ],
              })
            }
          >
            <Plus size={15} />
            添加自定义字段
          </Button>
          <p className='field-hint'>
            全部字段加密保存。敏感内容不参与搜索，所有自定义字段和验证码密钥均不发送给
            AI。
          </p>
        </div>
      </Disclosure>
    </>
  )
}
