export function filterInstalledPlugins(plugins, query = '') {
  if (!Array.isArray(plugins)) throw new TypeError('plugins must be an array')
  const community = plugins.filter((plugin) => plugin?.builtIn !== true)
  const normalized = String(query).trim().toLocaleLowerCase()
  if (normalized === '') return community
  return community.filter((plugin) => [plugin.name, plugin.displayName, plugin.description, plugin.publisher]
    .filter((value) => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase()
    .includes(normalized))
}

export function pluginCardPresentation(plugin) {
  if (plugin === null || typeof plugin !== 'object') throw new TypeError('plugin is required')
  if (!plugin.statusLabel || plugin.status === 'normal') return Object.freeze({ label: '', tone: 'quiet' })
  const tone = plugin.status === 'needs-attention'
    ? 'danger'
    : plugin.status === 'update-incompatible' || plugin.status === 'risk-running'
      ? 'warning'
      : 'quiet'
  return Object.freeze({ label: String(plugin.statusLabel), tone })
}

export function pluginInstallPresentation(phase) {
  const states = {
    queued: Object.freeze({ button: '等待安装…', message: '' }),
    installing: Object.freeze({ button: '正在安装…', message: '' }),
    preparing: Object.freeze({ button: '正在安装…', message: '正在准备插件…' }),
    finishing: Object.freeze({ button: '正在安装…', message: '正在完成安装…' }),
    installed: Object.freeze({ button: '已安装', message: '插件已安装' }),
    failed: Object.freeze({ button: '安装', message: '插件安装失败' }),
  }
  return states[phase] ?? states.installing
}

export function compatibilityDialogPresentation(kind) {
  if (kind === 'unknown') {
    return Object.freeze({
      title: '无法确认兼容性',
      description: '这个插件没有声明与当前 DeepSeek Harness Desktop 的兼容范围。继续安装通常没有问题，但存在无法正常运行的可能。',
      confirmLabel: '仍然安装',
      cancelHidden: false,
    })
  }
  if (kind === 'incompatible') {
    return Object.freeze({
      title: '这个插件尚未适配当前版本',
      description: '插件声明的 Runtime 版本与当前 Desktop 不一致，可能无法运行或导致界面异常。Desktop 会先在隔离环境中验证，启动失败时自动恢复原插件环境。',
      confirmLabel: '风险安装',
      cancelLabel: '取消安装',
      cancelHidden: false,
    })
  }
  if (kind === 'full-access') {
    return Object.freeze({
      title: '安装高级插件？',
      description: '这个插件来自外部来源，可以访问更多本地能力。只安装你信任的插件。',
      confirmLabel: '继续安装',
      cancelHidden: false,
    })
  }
  throw new TypeError('unknown plugin dialog kind')
}

export function pluginEnvironmentRepairPresentation(state) {
  const resolved = new Set([
    'disabled-by-user',
    'legacy-false-positive-repaired',
    'restored-by-user',
    'restored-by-direct-start',
  ])
  const needsRepair = state?.safeMode === true
    || (Array.isArray(state?.disabledPlugins) && state.disabledPlugins.length > 0)
    || (state?.currentIncident !== undefined && !resolved.has(state.currentIncident?.resolution))
  return Object.freeze({
    visible: needsRepair,
    title: '插件环境需要修复',
    description: '修复只会重建插件运行环境，不会删除聊天、设置或个人数据。',
  })
}

export function pluginEmptyPresentation({ installedCount, query = '' }) {
  if (Number(installedCount) > 0 && String(query).trim() !== '') {
    return Object.freeze({ title: '没有匹配的插件', description: '换个名称、说明或作者试试。', action: '' })
  }
  return Object.freeze({
    title: '还没有安装插件',
    description: '通过插件为 DeepSeek Harness 添加更多能力。',
    action: '发现插件',
  })
}
