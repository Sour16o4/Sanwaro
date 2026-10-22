-- Local development only (supabase db reset). Never pushed to the cloud project.
-- Owner logins with no salon yet, to try onboarding and tenant isolation:
--   owner1@sanwaro.test / password123
--   owner2@sanwaro.test / password123
--   owner3@sanwaro.test / password123   (dashboard E2E test)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
       extensions.crypt('password123', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
from (values ('10000000-0000-0000-0000-000000000001'::uuid, 'owner1@sanwaro.test'),
             ('10000000-0000-0000-0000-000000000002'::uuid, 'owner2@sanwaro.test'),
             ('10000000-0000-0000-0000-000000000003'::uuid, 'owner3@sanwaro.test')) u(id, email);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from auth.users where email in ('owner1@sanwaro.test', 'owner2@sanwaro.test', 'owner3@sanwaro.test');

-- Owner of the demo salon, which `npm run demo:reset` builds (http://localhost:3000/b/glow-salon):
--   demo@sanwaro.test / password123
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change, email_change_token_new)
values ('00000000-0000-0000-0000-000000000000', '10000000-0000-0000-0000-000000000009', 'authenticated',
        'authenticated', 'demo@sanwaro.test', extensions.crypt('password123', extensions.gen_salt('bf')), now(),
        '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
values (gen_random_uuid(), '10000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000009', 'email',
        '{"sub":"10000000-0000-0000-0000-000000000009","email":"demo@sanwaro.test","email_verified":true}', now(), now(), now());
