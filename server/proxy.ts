import ipaddr from 'ipaddr.js'

export function validateTrustedProxies(addresses: string[]) {
  return addresses.map((value) => {
    const address = value.trim()
    try {
      if (address.includes('/')) {
        const [network, prefix] = ipaddr.parseCIDR(address)
        const coversAllIPv4 =
          network.kind() === 'ipv6' &&
          prefix <= 96 &&
          ipaddr.parse('::ffff:0.0.0.0').match(network, prefix)
        if (prefix === 0 || coversAllIPv4)
          throw new Error('Unrestricted proxy range')
      } else ipaddr.parse(address)
    } catch {
      throw new Error(
        `TRUSTED_PROXIES 仅支持明确的代理 IP 或 CIDR，不能信任所有来源：${address}`
      )
    }
    return address
  })
}
