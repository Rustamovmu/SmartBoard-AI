import { PasswordService } from './password.service';

describe('password hashing', () => {
  it('uses real Argon2id, accepts the right password and rejects wrong/unknown accounts', async () => {
    const passwords = new PasswordService();
    await passwords.onModuleInit();
    const hash = await passwords.hash('synthetic-passphrase-for-a-test');
    expect(hash).toMatch(/^\$argon2id\$v=19\$/);
    expect(hash.split('$')[3].split(',').sort()).toEqual([
      'm=65536',
      'p=1',
      't=3',
    ]);
    expect(
      await passwords.verify('synthetic-passphrase-for-a-test', hash),
    ).toBe(true);
    expect(await passwords.verify('wrong-synthetic-password', hash)).toBe(
      false,
    );
    expect(await passwords.verify('synthetic-passphrase-for-a-test')).toBe(
      false,
    );
  });
});
