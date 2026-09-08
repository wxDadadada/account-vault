export function containsLabeledSecret(text: string) {
  return /(?:密码|口令|密钥|password|secret|api[ _-]?key|token)\s*(?:[:：=]|是|为|改为|改成|换成)\s*\S+/i.test(
    text
  )
}
