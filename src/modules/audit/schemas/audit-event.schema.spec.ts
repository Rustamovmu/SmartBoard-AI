import { model } from 'mongoose';
import { AuditEventSchema } from './audit-event.schema';
const Audit = model('AuditSubjectUnit', AuditEventSchema);
describe('audit subject validation', () => {
  it('keeps user subjects mandatory for existing actions', async () => {
    await expect(
      new Audit({
        _id: 'id',
        action: 'ADMIN_BOOTSTRAPPED',
        actorType: 'LOCAL_COMMAND',
        createdAt: new Date(),
      }).validate(),
    ).rejects.toMatchObject({ errors: { subjectUserId: expect.anything() } });
  });
  it('uses a content subject without a fabricated user subject', async () => {
    const entry = {
      _id: 'id',
      action: 'HELP_ENTRY_CHANGED',
      actorType: 'ADMIN',
      subjectHelpEntryId: 'entry',
      createdAt: new Date(),
    };
    await expect(new Audit(entry).validate()).resolves.toBeUndefined();
    await expect(
      new Audit({ ...entry, subjectHelpEntryId: undefined }).validate(),
    ).rejects.toMatchObject({
      errors: { subjectHelpEntryId: expect.anything() },
    });
  });
});

describe('community audit subjects', () => {
  it('requires a community post subject and preserves user subjects for older actions', async () => {
    const event = {
      _id: 'event',
      action: 'COMMUNITY_POST_CHANGED',
      actorType: 'USER',
      actorUserId: 'owner',
      subjectCommunityPostId: 'post',
      communityAction: 'CREATE',
      nextCommunityState: 'DRAFT',
      communityRevision: 1,
      createdAt: new Date(),
    };
    await expect(new Audit(event).validate()).resolves.toBeUndefined();
    await expect(
      new Audit({ ...event, subjectCommunityPostId: undefined }).validate(),
    ).rejects.toMatchObject({
      errors: { subjectCommunityPostId: expect.anything() },
    });
  });
});
