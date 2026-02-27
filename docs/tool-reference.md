# Tool Reference

## Messages

- `send_text(from, to, content, setInboxStatus?)`
- `list_messages(phoneNumberId, participants, maxResults?, createdAfter?, createdBefore?, pageToken?)`
- `get_message(id)`

## Conversations

- `list_conversations(phoneNumbers?, userId?, createdAfter?, createdBefore?, updatedAfter?, updatedBefore?, excludeInactive?, maxResults?, pageToken?)`

## Contacts

- `create_contact(firstName, lastName?, company?, role?, phoneNumbers?, emails?)`
- `list_contacts(maxResults?, pageToken?, externalIds?)`
- `get_contact(id)`
- `update_contact(id, firstName?, lastName?, company?, role?, phoneNumbers?, emails?)`
- `delete_contact(id)`
- `get_contact_custom_fields()`

## Calls

- `list_calls(phoneNumberId, participants, maxResults?, createdAfter?, createdBefore?, pageToken?)`
- `get_call(callId)`
- `get_call_recordings(callId)`
- `get_call_summary(callId)`
- `get_call_transcription(callId)`
- `get_voicemail(callId)`

## Phone Numbers

- `list_phone_numbers(userId?)`
- `get_phone_number(phoneNumberId)`

## Users

- `list_users()`
- `get_user(userId)`

## Webhooks

- `list_webhooks()`
