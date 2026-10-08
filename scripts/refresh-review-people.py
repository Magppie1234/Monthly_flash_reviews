"""Read-only staff sync. Credentials stay in the supplied ZIP and process memory.

Usage: python scripts/refresh-review-people.py --credentials-zip <path>
"""
import argparse
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sync(archive):
    mapping = json.loads((ROOT / 'config/flash-review-roles.json').read_text(encoding='utf-8'))
    with zipfile.ZipFile(archive) as z:
        files = [name for name in z.namelist() if name.endswith('/token_details.json') or name == 'token_details.json']
        if len(files) != 1:
            raise ValueError('Expected exactly one token_details.json in credential ZIP')
        creds = json.loads(z.read(files[0]))
    accounts, api = creds['accounts_url'].rstrip('/'), creds['api_domain'].rstrip('/')
    if (accounts, api) not in [('https://accounts.zoho.in', 'https://www.zohoapis.in'), ('https://accounts.zoho.com', 'https://www.zohoapis.com')]:
        raise ValueError('Unapproved Zoho host pair')

    def request(url, payload=None, token=None):
        headers = {'Authorization': 'Zoho-oauthtoken ' + token} if token else {}
        req = urllib.request.Request(url, data=payload, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=45) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            raise ValueError(f'Zoho HTTP {error.code}; check token scopes and permissions') from None

    payload = urllib.parse.urlencode({key: creds[key] for key in ['client_id', 'client_secret', 'refresh_token']} | {'grant_type': 'refresh_token'}).encode()
    auth = request(accounts + '/oauth/v2/token', payload)
    if not auth.get('access_token'):
        raise ValueError('OAuth refresh failed; saved directory unchanged')
    token = auth['access_token']
    org = request(api + '/crm/v8/org', token=token)
    if mapping['orgId'] != '60046349006' or not any(str(o.get('zgid')) == mapping['orgId'] for o in org.get('org', [])):
        raise ValueError('Organization mismatch; saved directory unchanged')
    roles = request(api + '/crm/v8/settings/roles', token=token).get('roles', [])
    allowed = {rid for ids in mapping['roles'].values() for rid in ids}
    if not allowed.issubset({role['id'] for role in roles}):
        raise ValueError('Mapped roles no longer exist; review mapping before syncing')
    explicit_ids = {p['id'] for entries in mapping.get('localAssignments', {}).values() for p in entries}
    people = {}
    for page in range(1, 101):
        response = request(api + f'/crm/v8/users?type=ActiveUsers&per_page=200&page={page}', token=token)
        if not isinstance(response.get('users'), list):
            raise ValueError('Incomplete user response; saved directory unchanged')
        for user in response['users']:
            role = user.get('role') or {}
            if (role.get('id') in allowed or user.get('id') in explicit_ids) and user.get('status') == 'active':
                people[user['id']] = {'id': user['id'], 'name': user['full_name'], 'roleId': role['id'], 'roleName': role['name'], 'status': 'active'}
        if not response.get('info', {}).get('more_records'):
            break
    else:
        raise ValueError('User pagination incomplete; saved directory unchanged')
    result = {'orgId': mapping['orgId'], 'fetchedAt': datetime.now(timezone.utc).isoformat(), 'source': 'Zoho CRM Users (ActiveUsers) and Roles', 'employees': list(people.values())}
    destination = ROOT / 'data/flash-review-roster.json'
    temporary = destination.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    os.replace(temporary, destination)
    print(f'Updated {len(people)} eligible active employees. No CRM records were changed.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--credentials-zip', type=Path, required=True)
    args = parser.parse_args()
    try:
        sync(args.credentials_zip)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        # Never dump HTTP bodies, tokens, credential objects or request headers.
        raise SystemExit(f'Staff sync failed ({type(error).__name__}). Saved directory unchanged; check configuration and Zoho access.')
