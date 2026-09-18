/**
 * The remote-control settings card: pairing security and device limits.
 * Registers into the `settings.plugin.item` slot the plugin-configuration
 * section renders, bound to the `remote-web-ui` settings namespace.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { PluginSettingsCard, ValueField, BooleanField, ChoiceField } from './PluginSettingsCard.tsx'
import { CardForm, booleanField, choiceField, numberField, textField, type CardActions, type CardShell, type FieldState as CardFieldState } from './settings-form.ts'

/** The remote-control fields this card edits (the namespace's full schema). */
export interface RemoteSettings {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** Token lifetime in ms; the QR link dies after this. */
  tokenTtlMs?: number
  /** A device is "online" while its lastSeenAt is newer than this (ms). */
  offlineAfterMs?: number
  /** Hard cap on paired device sessions (oldest evicted when full). */
  maxDevices?: number
  /** Cookie name carrying the paired device id. */
  cookieName?: string
  /** Fence flag: whether non-loopback /api requests must carry a live paired-device cookie. */
  requirePairingForLan?: boolean
  /** Full non-loopback /api policy. */
  remoteApiMode?: RemoteApiMode
  /** Public (tunneled) base URL the QR link is built from when set. */
  publicBaseUrl?: string
  /** When on, the plugin runs its own public tunnel automatically. */
  autoTunnel?: boolean
  /** Which transport the automatic tunnel drives. */
  tunnelTransport?: TunnelTransport
  /** SSH reverse tunnel destination: `host` or `user@host`. */
  sshTunnelServer?: string
  /** SSH server port. */
  sshTunnelPort?: number
  /** Port the forward exposes on the remote loopback (the proxy upstream). */
  sshTunnelRemotePort?: number
  /** Private key file handed to the ssh client as `-i`. */
  sshTunnelKeyPath?: string
  /** What the tunnel exposes: the mobile surface, or the whole application. */
  tunnelSurface?: TunnelSurface
  /** Mobile composer: plain Enter sends; off means Enter inserts a newline. */
  mobileEnterToSend?: boolean
}

/** Full non-loopback /api policy exposed by the remote plugin. */
export type RemoteApiMode = 'mobile-only' | 'legacy-full-api'

/** Automatic-tunnel transports exposed by the remote plugin. */
export type TunnelTransport = 'cloudflare' | 'ssh'

/** How much of the application the tunnel exposes. */
export type TunnelSurface = 'mobile' | 'full'

/** What the remote-control card renders. */
export interface RemoteSettingsCardState extends CardShell {
  /** Master switch. */
  enabled: CardFieldState
  /** Token lifetime. */
  tokenTtlMs: CardFieldState
  /** Device offline threshold. */
  offlineAfterMs: CardFieldState
  /** Paired-device cap. */
  maxDevices: CardFieldState
  /** Device cookie name. */
  cookieName: CardFieldState
  /** LAN fence flag. */
  requirePairingForLan: CardFieldState
  /** Full non-loopback /api policy. */
  remoteApiMode: CardFieldState
  /** Public (tunneled) base URL. */
  publicBaseUrl: CardFieldState
  /** Auto public tunnel switch. */
  autoTunnel: CardFieldState
  /** Automatic-tunnel transport. */
  tunnelTransport: CardFieldState
  /** SSH reverse tunnel destination. */
  sshTunnelServer: CardFieldState
  /** SSH server port. */
  sshTunnelPort: CardFieldState
  /** Port exposed on the remote loopback. */
  sshTunnelRemotePort: CardFieldState
  /** SSH private key path. */
  sshTunnelKeyPath: CardFieldState
  /** Tunnelled surface scope. */
  tunnelSurface: CardFieldState
  /** Mobile composer Enter-to-send switch. */
  mobileEnterToSend: CardFieldState
}

/** The registration-side face the card's slot entry injects. */
export interface RemoteSettingsCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer as useRemoteSettingsCard. */
    remoteSettingsCard: SnapshotStore<RemoteSettingsCardState>
  }
}

/** Bridges the `remote-web-ui` scope onto the card's staged form. */
export class RemoteSettingsCardController {
  private readonly form: CardForm<RemoteSettings>
  private readonly store: SnapshotStore<RemoteSettingsCardState>

  /** @param scope - the bound settings scope for the `remote-web-ui` namespace. */
  constructor(scope: SettingsScope<RemoteSettings>) {
    this.form = new CardForm(scope, [
      booleanField('enabled'),
      numberField('tokenTtlMs'),
      numberField('offlineAfterMs'),
      numberField('maxDevices'),
      textField('cookieName'),
      booleanField('requirePairingForLan'),
      choiceField('remoteApiMode', ['mobile-only', 'legacy-full-api']),
      textField('publicBaseUrl'),
      booleanField('autoTunnel'),
      choiceField('tunnelTransport', ['cloudflare', 'ssh']),
      textField('sshTunnelServer'),
      numberField('sshTunnelPort'),
      numberField('sshTunnelRemotePort'),
      textField('sshTunnelKeyPath'),
      choiceField('tunnelSurface', ['mobile', 'full']),
      booleanField('mobileEnterToSend'),
    ])
    this.store = this.form.bind(() => this.projection())
  }

  private projection(): RemoteSettingsCardState {
    return {
      ...this.form.shell(),
      enabled: this.form.field('enabled'),
      tokenTtlMs: this.form.field('tokenTtlMs'),
      offlineAfterMs: this.form.field('offlineAfterMs'),
      maxDevices: this.form.field('maxDevices'),
      cookieName: this.form.field('cookieName'),
      requirePairingForLan: this.form.field('requirePairingForLan'),
      remoteApiMode: this.form.field('remoteApiMode'),
      publicBaseUrl: this.form.field('publicBaseUrl'),
      autoTunnel: this.form.field('autoTunnel'),
      tunnelTransport: this.form.field('tunnelTransport'),
      sshTunnelServer: this.form.field('sshTunnelServer'),
      sshTunnelPort: this.form.field('sshTunnelPort'),
      sshTunnelRemotePort: this.form.field('sshTunnelRemotePort'),
      sshTunnelKeyPath: this.form.field('sshTunnelKeyPath'),
      tunnelSurface: this.form.field('tunnelSurface'),
      mobileEnterToSend: this.form.field('mobileEnterToSend'),
    }
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): RemoteSettingsCardFace {
    return { hooks: { remoteSettingsCard: this.store }, ...this.form.actions() }
  }
}

/** Props the renderer binds for the remote-control card. */
export type RemoteSettingsCardProps =
  PropsRuntime<'web-ui.plugin.item'>
  & PropsLocale<'remote'>
  & InjectFace<RemoteSettingsCardFace>

/**
 * Render the remote-control card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function RemoteSettingsCard(props: RemoteSettingsCardProps) {
  const { t } = props
  const state = props.useRemoteSettingsCard((snapshot: RemoteSettingsCardState) => snapshot)
  const disabled = !state.writable
  const fieldProps = {
    overriddenLabel: t('settings.overridden'),
    resetLabel: t('settings.reset'),
    invalidLabel: t('settings.invalidNumber'),
    disabled,
  }
  const choiceFieldProps = {
    ...fieldProps,
    invalidLabel: t('settings.invalidChoice'),
  }
  return (
    <PluginSettingsCard
      t={t}
      titleKey="settings.title"
      descriptionKey="settings.description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      <BooleanField
        id="settings-remote-enabled"
        label={t('settings.enabled')}
        hint={t('settings.enabledHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.enabled}
        onEdit={(text) => { props.edit('enabled', text) }}
        onReset={() => { props.resetField('enabled') }}
      />
      <ValueField
        id="settings-remote-token-ttl"
        label={t('settings.tokenTtlMs')}
        hint={t('settings.tokenTtlMsHint')}
        numeric
        {...fieldProps}
        {...state.tokenTtlMs}
        onEdit={(text) => { props.edit('tokenTtlMs', text) }}
        onReset={() => { props.resetField('tokenTtlMs') }}
      />
      <ValueField
        id="settings-remote-offline"
        label={t('settings.offlineAfterMs')}
        hint={t('settings.offlineAfterMsHint')}
        numeric
        {...fieldProps}
        {...state.offlineAfterMs}
        onEdit={(text) => { props.edit('offlineAfterMs', text) }}
        onReset={() => { props.resetField('offlineAfterMs') }}
      />
      <ValueField
        id="settings-remote-max-devices"
        label={t('settings.maxDevices')}
        hint={t('settings.maxDevicesHint')}
        numeric
        {...fieldProps}
        {...state.maxDevices}
        onEdit={(text) => { props.edit('maxDevices', text) }}
        onReset={() => { props.resetField('maxDevices') }}
      />
      <ValueField
        id="settings-remote-cookie"
        label={t('settings.cookieName')}
        hint={t('settings.cookieNameHint')}
        {...fieldProps}
        {...state.cookieName}
        onEdit={(text) => { props.edit('cookieName', text) }}
        onReset={() => { props.resetField('cookieName') }}
      />
      <BooleanField
        id="settings-remote-fence"
        label={t('settings.requirePairingForLan')}
        hint={t('settings.requirePairingForLanHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.requirePairingForLan}
        onEdit={(text) => { props.edit('requirePairingForLan', text) }}
        onReset={() => { props.resetField('requirePairingForLan') }}
      />
      <ChoiceField
        id="settings-remote-api-mode"
        label={t('settings.remoteApiMode')}
        hint={t('settings.remoteApiModeHint')}
        inheritLabel={t('settings.inherit')}
        choices={[
          { value: 'mobile-only', label: t('settings.remoteApiModeMobileOnly') },
          { value: 'legacy-full-api', label: t('settings.remoteApiModeLegacyFullApi') },
        ]}
        {...choiceFieldProps}
        {...state.remoteApiMode}
        onEdit={(text) => { props.edit('remoteApiMode', text) }}
        onReset={() => { props.resetField('remoteApiMode') }}
      />
      <ValueField
        id="settings-remote-public-base"
        label={t('settings.publicBaseUrl')}
        hint={t('settings.publicBaseUrlHint')}
        placeholder="https://example.trycloudflare.com"
        {...fieldProps}
        {...state.publicBaseUrl}
        onEdit={(text) => { props.edit('publicBaseUrl', text) }}
        onReset={() => { props.resetField('publicBaseUrl') }}
      />
      <BooleanField
        id="settings-remote-auto-tunnel"
        label={t('settings.autoTunnel')}
        hint={t('settings.autoTunnelHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.autoTunnel}
        onEdit={(text) => { props.edit('autoTunnel', text) }}
        onReset={() => { props.resetField('autoTunnel') }}
      />
      <ChoiceField
        id="settings-remote-tunnel-transport"
        label={t('settings.tunnelTransport')}
        hint={t('settings.tunnelTransportHint')}
        inheritLabel={t('settings.inherit')}
        choices={[
          { value: 'cloudflare', label: t('settings.tunnelTransportCloudflare') },
          { value: 'ssh', label: t('settings.tunnelTransportSsh') },
        ]}
        {...choiceFieldProps}
        {...state.tunnelTransport}
        onEdit={(text) => { props.edit('tunnelTransport', text) }}
        onReset={() => { props.resetField('tunnelTransport') }}
      />
      <ValueField
        id="settings-remote-ssh-server"
        label={t('settings.sshTunnelServer')}
        hint={t('settings.sshTunnelServerHint')}
        placeholder="root@tunnel.example.com"
        {...fieldProps}
        {...state.sshTunnelServer}
        onEdit={(text) => { props.edit('sshTunnelServer', text) }}
        onReset={() => { props.resetField('sshTunnelServer') }}
      />
      <ValueField
        id="settings-remote-ssh-port"
        label={t('settings.sshTunnelPort')}
        hint={t('settings.sshTunnelPortHint')}
        numeric
        {...fieldProps}
        {...state.sshTunnelPort}
        onEdit={(text) => { props.edit('sshTunnelPort', text) }}
        onReset={() => { props.resetField('sshTunnelPort') }}
      />
      <ValueField
        id="settings-remote-ssh-remote-port"
        label={t('settings.sshTunnelRemotePort')}
        hint={t('settings.sshTunnelRemotePortHint')}
        numeric
        {...fieldProps}
        {...state.sshTunnelRemotePort}
        onEdit={(text) => { props.edit('sshTunnelRemotePort', text) }}
        onReset={() => { props.resetField('sshTunnelRemotePort') }}
      />
      <ValueField
        id="settings-remote-ssh-key"
        label={t('settings.sshTunnelKeyPath')}
        hint={t('settings.sshTunnelKeyPathHint')}
        {...fieldProps}
        {...state.sshTunnelKeyPath}
        onEdit={(text) => { props.edit('sshTunnelKeyPath', text) }}
        onReset={() => { props.resetField('sshTunnelKeyPath') }}
      />
      <ChoiceField
        id="settings-remote-tunnel-surface"
        label={t('settings.tunnelSurface')}
        hint={t('settings.tunnelSurfaceHint')}
        inheritLabel={t('settings.inherit')}
        choices={[
          { value: 'mobile', label: t('settings.tunnelSurfaceMobile') },
          { value: 'full', label: t('settings.tunnelSurfaceFull') },
        ]}
        {...choiceFieldProps}
        {...state.tunnelSurface}
        onEdit={(text) => { props.edit('tunnelSurface', text) }}
        onReset={() => { props.resetField('tunnelSurface') }}
      />
      <BooleanField
        id="settings-remote-mobile-enter"
        label={t('settings.mobileEnterToSend')}
        hint={t('settings.mobileEnterToSendHint')}
        inheritLabel={t('settings.inherit')}
        onLabel={t('settings.on')}
        offLabel={t('settings.off')}
        {...fieldProps}
        {...state.mobileEnterToSend}
        onEdit={(text) => { props.edit('mobileEnterToSend', text) }}
        onReset={() => { props.resetField('mobileEnterToSend') }}
      />
    </PluginSettingsCard>
  )
}
