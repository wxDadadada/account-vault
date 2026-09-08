import { z } from 'zod'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit, { normalizeIP } from '@fastify/rate-limit'
import staticFiles from '@fastify/static'
import { and, eq, lt } from 'drizzle-orm'
import Fastify, {
  LogController,
  type FastifyRequest,
  type FastifyReply,
} from 'fastify'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import * as OTPAuth from 'otpauth'
import {
  assertChatSafe,
  chatRequestSchema,
  chatResponseSchema,
  type ChatRequest,
} from '../shared/ai-chat.js'
import {
  credentialsSchema,
  encoded32,
  envelopeSchema,
  KDF_ITERATIONS,
  type LoginProfile,
  type PublicProfile,
} from '../shared/protocol.js'
import {
  aiRequestSchema,
  callAI,
  callChat,
  defaultAIHosts,
  type AIRequest,
} from './ai.js'
import { openDatabase, backupDatabase } from './database.js'
import { validateTrustedProxies } from './proxy.js'
import { owner, sessions, vault } from './schema.js'
import {
  hashProof,
  hashToken,
  serverSealer,
  totp,
  verifyProof,
  verifyTotp,
} from './security.js'

export type AppOptions = {
  dataDir: string
  origin: string
  staticDir?: string
  test?: boolean
  setupToken?: string
  backupDir?: string
  aiHosts?: string[]
  trustedProxies?: string[]
  aiCaller?: (input: AIRequest) => Promise<unknown>
  chatCaller?: (input: ChatRequest) => Promise<unknown>
}
class HTTPError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'REQUEST_FAILED'
  ) {
    super(message)
  }
}
export async function buildApp(options: AppOptions) {
  const appOrigin = new URL(options.origin)
  if (!['http:', 'https:'].includes(appOrigin.protocol))
    throw new Error('APP_ORIGIN 必须是网站的 http 或 https 地址')
  if (
    appOrigin.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(appOrigin.hostname)
  )
    throw new Error('远程访问需要 HTTPS，请将 APP_ORIGIN 设为 https 地址')
  const secureCookie = appOrigin.protocol === 'https:'
  const remoteOrigin = !['127.0.0.1', 'localhost', '[::1]'].includes(
    appOrigin.hostname
  )
  if (remoteOrigin && !options.setupToken)
    throw new Error('远程部署需要初始化令牌')
  const trustedProxies = validateTrustedProxies(options.trustedProxies ?? [])
  if (remoteOrigin && !trustedProxies.length)
    throw new Error(
      '远程部署需要 TRUSTED_PROXIES，请配置实际直连代理的 IP 或 CIDR；参见 docs/deployment.md'
    )
  const app = Fastify({
    logger: options.test
      ? false
      : {
          level: 'info',
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
        },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 9 * 1024 * 1024,
    requestTimeout: 45000,
    trustProxy: trustedProxies.length ? trustedProxies : false,
  })
  const { db, native } = openDatabase(options.dataDir)
  const seal = serverSealer(options.dataDir)
  const SESSION_COOKIE = secureCookie ? '__Host-keyfolio' : 'keyfolio_session'
  const SESSION_LIFETIME = 12 * 60 * 60 * 1000
  const sourceKey = (req: FastifyRequest) => `ip:${normalizeIP(req.ip)}`
  const sessionKey = (req: FastifyRequest) => {
    const session = activeSession(req)
    return session ? `session:${session.tokenHash}` : sourceKey(req)
  }
  const securityLimit = {
    rateLimit: {
      max: options.test ? 1000 : 8,
      timeWindow: '15 minutes',
      keyGenerator: sessionKey,
    },
  }
  const authLimit = {
    rateLimit: { ...securityLimit.rateLimit, keyGenerator: sourceKey },
  }
  let lastBackupAt: string | null = null
  let backingUp = false

  await app.register(cookie)
  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: secureCookie ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
  await app.register(rateLimit, {
    max: options.test ? 10000 : 180,
    timeWindow: '1 minute',
    keyGenerator: sessionKey,
    errorResponseBuilder: (_req, context) =>
      new HTTPError(
        context.statusCode,
        '操作太频繁，请稍后再试',
        'RATE_LIMITED'
      ),
  })
  app.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store')
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (req.headers['x-keyfolio'] !== '1')
        throw new HTTPError(403, '请求验证失败', 'CSRF')
      const localAliases = ['localhost', '127.0.0.1'].includes(
        appOrigin.hostname
      )
        ? [
            `${appOrigin.protocol}//localhost:${appOrigin.port}`,
            `${appOrigin.protocol}//127.0.0.1:${appOrigin.port}`,
          ]
        : []
      const allowed = [
        appOrigin.origin,
        ...localAliases,
        ...(options.test || process.env.NODE_ENV === 'production'
          ? []
          : ['http://127.0.0.1:5188', 'http://localhost:5188']),
      ]
      if (req.headers.origin && !allowed.includes(req.headers.origin))
        throw new HTTPError(403, '请求来源不受信任', 'CSRF')
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new HTTPError(403, '不允许跨站请求', 'CSRF')
    }
  })
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({ error: '提交内容格式不正确，请检查字段', code: 'VALIDATION' })
    const known =
      error instanceof Error
        ? (error as Error & { statusCode?: number; code?: string })
        : new Error('请求失败')
    const status =
      error instanceof HTTPError
        ? error.statusCode
        : 'statusCode' in known && typeof known.statusCode === 'number'
          ? known.statusCode
          : 500
    if (status >= 500)
      app.log.error({
        message: 'Request failed',
        code: 'code' in known ? known.code : 'INTERNAL',
      })
    return reply.code(status).send({
      error: status >= 500 ? '服务暂时无法完成请求，请稍后重试' : known.message,
      code: error instanceof HTTPError ? error.code : 'REQUEST_FAILED',
    })
  })
  function ownerRow() {
    const row = db.select().from(owner).where(eq(owner.id, 1)).get()
    if (!row) throw new HTTPError(409, '请先创建账号空间', 'NOT_INITIALIZED')
    return row
  }
  function publicProfile(row = ownerRow()): PublicProfile {
    return {
      username: row.username,
      kdfSalt: row.kdfSalt,
      wrappedKey: JSON.parse(row.wrappedKey),
      recoveryWrappedKey: JSON.parse(row.recoveryWrappedKey),
      kdfIterations: KDF_ITERATIONS,
    }
  }
  function loginProfile(row = ownerRow()): LoginProfile {
    return {
      username: row.username,
      kdfSalt: row.kdfSalt,
      recoveryWrappedKey: JSON.parse(row.recoveryWrappedKey),
      kdfIterations: KDF_ITERATIONS,
    }
  }
  function vaultState() {
    const row = db.select().from(vault).where(eq(vault.id, 1)).get()
    if (!row) throw new HTTPError(500, '保险库不可用')
    return {
      revision: row.revision,
      payload: JSON.parse(row.payload),
      updatedAt: row.updatedAt,
    }
  }
  function activeSession(req: FastifyRequest) {
    const token = req.cookies[SESSION_COOKIE]
    if (!token) return null
    const session = db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .get()
    return session && session.expiresAt > Date.now() ? session : null
  }
  function requireSession(req: FastifyRequest) {
    const session = activeSession(req)
    if (!session)
      throw new HTTPError(401, '登录已过期，请重新解锁', 'UNAUTHENTICATED')
    return session
  }
  function startSession(req: FastifyRequest, reply: FastifyReply) {
    db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run()
    if (req.cookies[SESSION_COOKIE])
      db.delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(req.cookies[SESSION_COOKIE]!)))
        .run()
    const token = randomBytes(32).toString('base64url')
    db.insert(sessions)
      .values({
        tokenHash: hashToken(token),
        expiresAt: Date.now() + SESSION_LIFETIME,
      })
      .run()
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/',
      maxAge: SESSION_LIFETIME / 1000,
    })
  }
  function checkOTP(
    row: ReturnType<typeof ownerRow>,
    token: string | undefined
  ) {
    if (!row.totpSecret) return
    if (!token)
      throw new HTTPError(401, '请输入验证器中的 6 位验证码', 'TOTP_REQUIRED')
    const step = verifyTotp(seal.open(row.totpSecret), token, row.lastTotpStep)
    if (step === null)
      throw new HTTPError(
        401,
        '验证码不正确或已使用，请等待下一组验证码',
        'TOTP_INVALID'
      )
    const changed = db
      .update(owner)
      .set({ lastTotpStep: step })
      .where(and(eq(owner.id, 1), eq(owner.lastTotpStep, row.lastTotpStep)))
      .run()
    if (!changed.changes)
      throw new HTTPError(
        401,
        '验证码已使用，请等待下一组验证码',
        'TOTP_INVALID'
      )
  }
  const runBackup = async (force = false) => {
    if (backingUp) {
      if (force) throw new HTTPError(409, '备份正在进行，请稍后查看')
      return
    }
    if (!db.select().from(owner).get()) return
    backingUp = true
    try {
      lastBackupAt = (
        await backupDatabase(
          native,
          options.backupDir ?? join(options.dataDir, 'backups'),
          14,
          force
        )
      ).lastBackupAt
    } catch {
      app.log.error('Database backup failed')
      if (force) throw new HTTPError(500, '备份失败')
    } finally {
      backingUp = false
    }
  }
  let backupTimer: ReturnType<typeof setInterval> | undefined
  app.addHook('onReady', async () => {
    if (!options.test) {
      await runBackup()
      backupTimer = setInterval(() => void runBackup(), 60 * 60 * 1000)
      backupTimer.unref()
    }
  })
  app.addHook('onClose', async () => {
    if (backupTimer) clearInterval(backupTimer)
    native.close()
  })

  app.get('/api/health', async () => ({ ok: true, app: 'keyfolio' }))
  app.get('/api/auth/status', async () => {
    const row = db.select().from(owner).get()
    return row
      ? { initialized: true, profile: loginProfile(row) }
      : { initialized: false, requiresSetupToken: !!options.setupToken }
  })
  app.post('/api/auth/setup', { config: authLimit }, async (req, reply) => {
    if (db.select().from(owner).get())
      throw new HTTPError(
        409,
        '账号空间已经创建，请登录',
        'ALREADY_INITIALIZED'
      )
    const input = z
      .object({
        credentials: credentialsSchema,
        payload: envelopeSchema,
        setupToken: z.string().max(200).optional(),
      })
      .strict()
      .parse(req.body)
    if (
      options.setupToken &&
      !timingSafeEqual(
        Buffer.from(hashToken(input.setupToken ?? '')),
        Buffer.from(hashToken(options.setupToken))
      )
    )
      throw new HTTPError(
        403,
        '初始化令牌不正确，请从服务器获取',
        'INVALID_SETUP_TOKEN'
      )
    const [authHash, recoveryHash] = await Promise.all([
      hashProof(input.credentials.authProof),
      hashProof(input.credentials.recoveryProof),
    ])
    native.transaction(() => {
      if (db.select().from(owner).get())
        throw new HTTPError(
          409,
          '账号空间已经创建，请登录',
          'ALREADY_INITIALIZED'
        )
      db.insert(owner)
        .values({
          id: 1,
          username: input.credentials.username,
          kdfSalt: input.credentials.kdfSalt,
          wrappedKey: JSON.stringify(input.credentials.wrappedKey),
          recoveryWrappedKey: JSON.stringify(
            input.credentials.recoveryWrappedKey
          ),
          authHash,
          recoveryHash,
          createdAt: new Date().toISOString(),
        })
        .run()
      db.insert(vault)
        .values({
          id: 1,
          revision: 1,
          payload: JSON.stringify(input.payload),
          updatedAt: new Date().toISOString(),
        })
        .run()
    })()
    startSession(req, reply)
    return { profile: publicProfile(), vault: vaultState() }
  })
  app.post('/api/auth/login', { config: authLimit }, async (req, reply) => {
    const input = z
      .object({
        username: z.string().max(64),
        authProof: encoded32,
        otp: z.string().max(10).optional(),
      })
      .strict()
      .parse(req.body)
    const row = ownerRow()
    const valid = await verifyProof(input.authProof, row.authHash)
    if (!valid || input.username !== row.username)
      throw new HTTPError(401, '用户名或主密码不正确', 'INVALID_CREDENTIALS')
    const current = ownerRow()
    if (current.authHash !== row.authHash)
      throw new HTTPError(
        401,
        '凭据已经更新，请重新登录',
        'INVALID_CREDENTIALS'
      )
    checkOTP(current, input.otp)
    startSession(req, reply)
    return { profile: publicProfile(), vault: vaultState() }
  })
  app.post('/api/auth/logout', async (req, reply) => {
    if (req.cookies[SESSION_COOKIE])
      db.delete(sessions)
        .where(eq(sessions.tokenHash, hashToken(req.cookies[SESSION_COOKIE]!)))
        .run()
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
    })
    return { ok: true }
  })
  app.get('/api/vault', async (req) => {
    requireSession(req)
    return vaultState()
  })
  app.put('/api/vault', async (req) => {
    requireSession(req)
    const input = z
      .object({ revision: z.number().int().min(1), payload: envelopeSchema })
      .strict()
      .parse(req.body)
    const result = db
      .update(vault)
      .set({
        payload: JSON.stringify(input.payload),
        revision: input.revision + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(vault.id, 1), eq(vault.revision, input.revision)))
      .run()
    if (!result.changes)
      throw new HTTPError(
        409,
        '其他设备已更新账号库。本次修改尚未保存，请先同步最新内容。',
        'REVISION_CONFLICT'
      )
    return vaultState()
  })
  app.post(
    '/api/auth/credentials',
    { config: securityLimit },
    async (req, reply) => {
      requireSession(req)
      const input = z
        .object({ currentProof: encoded32, credentials: credentialsSchema })
        .strict()
        .parse(req.body)
      const row = ownerRow()
      if (!(await verifyProof(input.currentProof, row.authHash)))
        throw new HTTPError(401, '当前主密码不正确', 'INVALID_CREDENTIALS')
      const [authHash, recoveryHash] = await Promise.all([
        hashProof(input.credentials.authProof),
        hashProof(input.credentials.recoveryProof),
      ])
      native.transaction(() => {
        // Authorization may have been revoked while scrypt was running.
        requireSession(req)
        if (ownerRow().authHash !== row.authHash)
          throw new HTTPError(
            409,
            '凭据已经更新，请重新解锁',
            'CREDENTIALS_CHANGED'
          )
        db.update(owner)
          .set({
            username: input.credentials.username,
            kdfSalt: input.credentials.kdfSalt,
            wrappedKey: JSON.stringify(input.credentials.wrappedKey),
            recoveryWrappedKey: JSON.stringify(
              input.credentials.recoveryWrappedKey
            ),
            authHash,
            recoveryHash,
          })
          .where(eq(owner.id, 1))
          .run()
        db.delete(sessions).run()
      })()
      startSession(req, reply)
      return { profile: publicProfile(), vault: vaultState() }
    }
  )
  app.post('/api/auth/recover', { config: authLimit }, async (req, reply) => {
    const input = z
      .object({
        currentRecoveryProof: encoded32,
        credentials: credentialsSchema,
      })
      .strict()
      .parse(req.body)
    const row = ownerRow()
    if (!(await verifyProof(input.currentRecoveryProof, row.recoveryHash)))
      throw new HTTPError(401, '恢复密钥不正确', 'INVALID_RECOVERY')
    const [authHash, recoveryHash] = await Promise.all([
      hashProof(input.credentials.authProof),
      hashProof(input.credentials.recoveryProof),
    ])
    native.transaction(() => {
      if (ownerRow().recoveryHash !== row.recoveryHash)
        throw new HTTPError(409, '恢复密钥已经更新', 'CREDENTIALS_CHANGED')
      db.update(owner)
        .set({
          username: input.credentials.username,
          kdfSalt: input.credentials.kdfSalt,
          wrappedKey: JSON.stringify(input.credentials.wrappedKey),
          recoveryWrappedKey: JSON.stringify(
            input.credentials.recoveryWrappedKey
          ),
          authHash,
          recoveryHash,
          totpSecret: null,
          lastTotpStep: -1,
        })
        .where(eq(owner.id, 1))
        .run()
      db.delete(sessions).run()
    })()
    startSession(req, reply)
    return { profile: publicProfile(), vault: vaultState() }
  })
  app.get('/api/security', async (req) => {
    requireSession(req)
    return {
      totpEnabled: !!ownerRow().totpSecret,
      lastBackupAt,
      aiHosts: options.aiHosts ?? defaultAIHosts,
    }
  })
  app.post(
    '/api/security/totp/start',
    { config: securityLimit },
    async (req) => {
      const session = requireSession(req)
      const { authProof } = z
        .object({ authProof: encoded32 })
        .strict()
        .parse(req.body)
      const row = ownerRow()
      if (row.totpSecret) throw new HTTPError(409, '双重验证已经开启')
      if (!(await verifyProof(authProof, row.authHash)))
        throw new HTTPError(401, '主密码不正确')
      requireSession(req)
      const secret = new OTPAuth.Secret({ size: 20 }).base32
      db.update(sessions)
        .set({
          pendingTotp: seal.seal(secret),
          pendingExpiresAt: Date.now() + 5 * 60 * 1000,
        })
        .where(eq(sessions.tokenHash, session.tokenHash))
        .run()
      return { secret, uri: totp(secret, row.username).toString() }
    }
  )
  app.post(
    '/api/security/totp/enable',
    { config: securityLimit },
    async (req) => {
      const session = requireSession(req)
      const { otp } = z
        .object({ otp: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body)
      if (
        !session.pendingTotp ||
        !session.pendingExpiresAt ||
        session.pendingExpiresAt < Date.now()
      )
        throw new HTTPError(400, '设置已过期，请重新开始')
      const step = verifyTotp(seal.open(session.pendingTotp), otp, -1)
      if (step === null) throw new HTTPError(400, '验证码不正确')
      native.transaction(() => {
        if (ownerRow().totpSecret) throw new HTTPError(409, '双重验证已经开启')
        db.update(owner)
          .set({ totpSecret: session.pendingTotp, lastTotpStep: step })
          .where(eq(owner.id, 1))
          .run()
        db.delete(sessions).run()
      })()
      return { ok: true, relogin: true }
    }
  )
  app.post(
    '/api/security/totp/disable',
    { config: securityLimit },
    async (req) => {
      requireSession(req)
      const input = z
        .object({ authProof: encoded32, otp: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(req.body)
      const row = ownerRow()
      if (!(await verifyProof(input.authProof, row.authHash)))
        throw new HTTPError(401, '主密码不正确')
      requireSession(req)
      checkOTP(ownerRow(), input.otp)
      db.update(owner)
        .set({ totpSecret: null, lastTotpStep: -1 })
        .where(eq(owner.id, 1))
        .run()
      return { ok: true }
    }
  )
  app.post('/api/backup', async (req) => {
    requireSession(req)
    await runBackup(true)
    if (!lastBackupAt) throw new HTTPError(500, '备份失败')
    return { lastBackupAt }
  })
  app.post(
    '/api/ai/parse',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      requireSession(req)
      const input = aiRequestSchema.parse(req.body)
      try {
        return await (options.aiCaller
          ? options.aiCaller(input)
          : callAI(input, options.aiHosts))
      } catch (e) {
        throw new HTTPError(
          422,
          e instanceof Error && !e.message.includes('fetch')
            ? e.message
            : '无法连接 AI 服务，请检查配置或稍后重试',
          'AI_FAILED'
        )
      }
    }
  )
  app.post(
    '/api/ai/chat',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      requireSession(req)
      const input = chatRequestSchema.parse(req.body)
      try {
        assertChatSafe(input.turns)
        assertChatSafe(input.context)
        const result = chatResponseSchema.parse(
          await (options.chatCaller
            ? options.chatCaller(input)
            : callChat(input, options.aiHosts))
        )
        requireSession(req)
        if (result.mode !== input.mode)
          throw new Error('AI 回复模式不正确，请重试')
        return result
      } catch (e) {
        if (e instanceof HTTPError) throw e
        throw new HTTPError(
          422,
          e instanceof z.ZodError
            ? 'AI 回复格式不正确，当前草稿已保留，请重试'
            : e instanceof Error && !e.message.includes('fetch')
              ? e.message
              : '无法连接 AI 服务，请检查配置或稍后重试',
          'AI_FAILED'
        )
      }
    }
  )
  if (options.staticDir && existsSync(join(options.staticDir, 'index.html'))) {
    await app.register(staticFiles, {
      root: resolve(options.staticDir),
      prefix: '/',
      cacheControl: true,
      maxAge: '1h',
      setHeaders: (reply, path) => {
        if (path.endsWith('index.html'))
          reply.header('Cache-Control', 'no-store')
      },
    })
    app.setNotFoundHandler((req, reply) => {
      if (
        req.url.startsWith('/api/') ||
        req.method !== 'GET' ||
        /\.[a-z0-9]+(?:\?|$)/i.test(req.url)
      )
        return reply.code(404).send({ error: '没有找到该资源' })
      return reply.header('Cache-Control', 'no-store').sendFile('index.html')
    })
  }
  return app
}
