import mongoose from 'mongoose';
import getJSONFromQuery from 'api/utils/getJSONFromQuery';
import catchErrors from 'api/controllers/utils/catchErrors';
import getFromQuery from 'api/utils/getFromQuery';
import getOrgFromAuthInfo from 'lib/services/auth/authInfoSelectors/getOrgFromAuthInfo';
import getAuthFromRequest from 'lib/helpers/getAuthFromRequest';
import getScopeFilter from 'lib/services/auth/filters/getScopeFilter';
import { CursorDirection } from 'personas/dist/service/constants';
import Locked from 'personas/dist/errors/Locked';
import { MAX_TIME_MS, MAX_SCAN } from 'lib/models/plugins/addCRUDFunctions';
import parseQuery from 'lib/helpers/parseQuery';
import asignIdentifierToStatements from 'lib/services/persona/asignIdentifierToStatements';
import identifierHasStatement from 'lib/services/persona/identifierHasStatement';
import {
  isUndefined,
  omitBy,
} from 'lodash';

const objectId = mongoose.Types.ObjectId;

const MODEL_NAME = 'personaIdentifier';

const personaIdentifierConnection = catchErrors(async (req, res) => {
  const { before, after } = req.query;

  const sort = getJSONFromQuery(req, 'sort', { _id: 1 });
  const hint = getJSONFromQuery(req, 'hint', undefined);
  const project = getJSONFromQuery(req, 'project', undefined);
  const first = getFromQuery(req, 'first', undefined, parseInt);
  const last = getFromQuery(req, 'last', undefined, parseInt);
  const authInfo = getAuthFromRequest(req);

  const scopeFilter = await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'view',
    authInfo
  });

  const {
    persona,
    ...inFilter
  } = getJSONFromQuery(req, 'filter', {});

  const filter = {
    ...inFilter,
    persona: persona ? objectId(persona) : undefined,
    ...scopeFilter
  };
  const filterNoUndefined = omitBy(filter, isUndefined);

  const identifiers = await req.personaService.getIdentifiers({
    limit: first || last || 10,
    direction: CursorDirection[before ? 'BACKWARDS' : 'FORWARDS'],
    sort,
    cursor: after || before,
    organisation: getOrgFromAuthInfo(authInfo),
    filter: filterNoUndefined,
    project,
    hint,
    maxTimeMS: MAX_TIME_MS,
    maxScan: MAX_SCAN
  });

  return res.status(200).send(identifiers);
});

const addPersonaIdentifier = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'create',
    authInfo
  });

  const organisation = getOrgFromAuthInfo(authInfo);

  const { identifier } = await req.personaService.createIdentifier({
    ifi: req.body.ifi,
    organisation,
    persona: req.body.persona,
  });

  // assign persona and personaIdentifier to statements
  asignIdentifierToStatements({ organisation, identifier });

  return res.status(200).send(identifier);
});

/**
 * Upsert a personaIdentifier
 * Creates if does not exist and assigns to new persona
 * Updates
 */
const upsertPersonaIdentifier = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'create',
    authInfo
  });

  const organisation = getOrgFromAuthInfo(authInfo);
  const toPersona = req.body.persona;
  if (!toPersona) {
    try {
      // if we had no persona, attempt to create an ident with a new persona
      const { identifier } = await req.personaService.createUpdateIdentifierPersona({
        ifi: req.body.ifi,
        organisation,
        personaName: JSON.stringify(req.body.ifi, null, 2),
      });

      // assign persona and personaIdentifier to statements
      asignIdentifierToStatements({ organisation, identifier });

      return res.status(200).send(identifier);
    } catch (err) {
      // if there was a lock then the ident already existed, so just return it
      if (err instanceof Locked) {
        return res.status(200).send(err.identifier);
      }
      // throw any other error
      throw err;
    }
  }

  // otherwise update the identifier's persona
  const { identifier } = await req.personaService.overwriteIdentifier({
    ifi: req.body.ifi,
    organisation,
    persona: toPersona
  });

  // assign persona and personaIdentifier to statements
  asignIdentifierToStatements({ organisation, identifier });

  return res.status(200).send(identifier);
});

const getPersonaIdentifier = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'view',
    authInfo
  });

  const { identifier } = await req.personaService.getIdentifier({
    organisation: getOrgFromAuthInfo(authInfo),
    id: req.params.personaIdentifierId
  });

  return res.status(200).send(identifier);
});

const getPersonaIdentifiers = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'view',
    authInfo
  });

  const { identifiers } = await req.personaService.getPersonaIdentifiers({
    ...req.query,
    organisation: getOrgFromAuthInfo(authInfo),
  });

  return res.status(200).send(identifiers);
});

/**
 * Update the personaIdentifier
 * Only the persona can be changed via this method
 */
const updatePersonaIdentifier = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'edit',
    authInfo
  });

  const organisation = getOrgFromAuthInfo(authInfo);
  const { identifier } = await req.personaService.setIdentifierPersona({
    organisation,
    id: req.params.personaIdentifierId,
    persona: req.body.persona
  });

  // assign persona and personaIdentifier to statements
  asignIdentifierToStatements({ organisation, identifier });

  return res.status(200).send(identifier);
});

const deletePersonaIdentifier = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'delete',
    authInfo
  });

  const organisation = getOrgFromAuthInfo(authInfo);
  const identifierId = req.params.personaIdentifierId;

  const hasStatement = identifierHasStatement({ organisation, identifierId });
  if (hasStatement) {
    throw new Error('Cannot remove personaIdentifier; statements exists in LRS with ifi');
  }

  await req.personaService.deletePersonaIdentifier({
    organisation,
    id: identifierId
  });

  return res.status(200).send();
});

const personaIdentifierCount = catchErrors(async (req, res) => {
  const authInfo = getAuthFromRequest(req);

  const scopeFilter = await getScopeFilter({
    modelName: MODEL_NAME,
    actionName: 'view',
    authInfo
  });

  const userFilter = await parseQuery(req.query.query);

  const filter = {
    ...userFilter,
    ...scopeFilter
  };

  const count = await req.personaService.getPersonaIdentifierCount({
    organisation: getOrgFromAuthInfo(authInfo),
    filter
  });

  return res.status(200).send(count);
});

export default {
  getPersonaIdentifier,
  getPersonaIdentifiers,
  updatePersonaIdentifier,
  addPersonaIdentifier,
  upsertPersonaIdentifier,
  deletePersonaIdentifier,
  personaIdentifierCount,
  personaIdentifierConnection,
};
