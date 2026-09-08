import { Secret, TOTP, URI } from 'otpauth'

export function parseTOTP(value: string): TOTP {
  const input = value.trim()
  if (!input) throw new Error('请输入验证码密钥')
  const otp = /^otpauth:\/\//i.test(input)
    ? URI.parse(input)
    : new TOTP({
        secret: Secret.fromBase32(input.replace(/\s/g, '').toUpperCase()),
      })
  if (
    !(otp instanceof TOTP) ||
    !['SHA1', 'SHA256', 'SHA512'].includes(otp.algorithm) ||
    ![6, 8].includes(otp.digits) ||
    !Number.isInteger(otp.period) ||
    otp.period < 15 ||
    otp.period > 120 ||
    otp.secret.bytes.length < 10 ||
    otp.secret.bytes.length > 128
  )
    throw new Error('请使用有效的 TOTP 密钥（6 或 8 位，周期 15–120 秒）')
  return otp
}

export function validTOTP(value: string) {
  try {
    parseTOTP(value)
    return true
  } catch {
    return false
  }
}
