export const DESKTOP_DISTRIBUTION_IDENTITY = Object.freeze({
  owner: 'ningbai牛逼',
  ownerSlug: 'ningbainb',
  appId: 'com.ningbainb.deepseek-harness.desktop',
  installerGuid: '88abe781-9bbf-5b27-9200-c24696774d39',
  legacyInstallerGuid: '6d90015c-c2fd-5312-844b-e2226e35e28f',
  packageName: '@linxin666/dsh-desktop',
  productName: 'DeepSeek Harness Desktop',
  profile: 'desktop',
  protocol: 'dsh-community',
  legacyProtocol: 'dsh',
  defaultHomeDirectoryName: '.dsh-community',
  updateProvider: Object.freeze({
    provider: 'github',
    owner: 'ningbainb',
    repo: 'deepseek-harness-desktop',
  }),
})

export function desktopDeepLink(path = '') {
  const normalized = String(path).replace(/^\/+/, '')
  return `${DESKTOP_DISTRIBUTION_IDENTITY.protocol}://${normalized}`
}
