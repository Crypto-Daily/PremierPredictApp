# Meta AI WhatsApp Transport Research

Research area for integrating WhatsApp Meta AI transport into Sophie/Hermes.

## Target

Meta AI JID:

867051314767696@bot

Persona ID:

867051314767696$760019659443059

## Confirmed

- Baileys version: 7.0.0-rc.9
- Normal Baileys sendMessage() reaches the Meta AI chat but Meta AI does not process it.
- Manual messages sent from WhatsApp are processed by Meta AI.
- Meta AI can generate real images through WhatsApp.
- MessageContextInfo contains:
  - messageSecret
  - botMessageSecret
  - botMetadata
- proto.BotMetadata is exposed directly under proto.
- BotMetadata supports personaId.
- Baileys supports additionalNodes in relayMessage().
- Baileys currently ignores incoming enc type="msmsg" payloads.

## Known derivation

botMessageSecret is derived as:

HKDF-SHA256(
  messageSecret,
  salt = empty,
  info = "Bot Message",
  length = 32
)

## Protobuf structures

Confirmed:

- proto.BotMetadata
- proto.MessageContextInfo
- proto.MessageSecretMessage
- proto.SecretEncryptedMessage

Not exposed in this Baileys build:

- proto.BotInvokeMessage
- proto.Message.BotInvokeMessage

## Remaining objectives

1. Recover exact outgoing <bot> participant-node structure.
2. Recover exact encryption applied to bot participant payload.
3. Capture and decode incoming Meta AI msmsg responses.
4. Support text responses.
5. Support Meta AI image-generation responses.
6. Integrate into Hermes only after the transport is verified.

## Safety

This is isolated research. Do not modify the installed Baileys package,
production Sophie code, Hermes, or the existing WhatsApp authentication
state while reverse-engineering the transport.
