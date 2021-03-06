import { ReactiveVar } from 'meteor/reactive-var'
import { fromJS } from 'immutable'
import { applyMiddleware, compose, createStore } from 'redux'
import { createEpicMiddleware, combineEpics } from 'redux-observable'
import Rx from 'rxjs/Rx'

export const allStores = new Map()
export const activeStore = new ReactiveVar()

const getInitialValue = ({ type, meta }, Collections) => {
    return Promise.resolve()
        .then(() => {
            let { collection, id } = meta.store
            if (id) {
                return Collections[collection].findOne(id)
            } else {
                return Collections[collection].findOne()
            }
        })
        .then(doc => fromJS(doc))
}

const createReducer = (mapActionsToReducers, initialValue) => {
    return (state, action) => {
        if (!state) return initialValue
        let actionReducer = mapActionsToReducers[action.type] || (s => s)
        return actionReducer(state, action.payload)
    }
}

const storeToObservable = (store) => {
    let s = new Rx.Subject()
    store.subscribe(() => s.next(store.getState()))
    return s.asObservable()
}

const composeEnhancers = ((typeof window !== 'undefined') && (window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__)) || compose
const makeStoreFromReducer = (reducer, ...middleware) => createStore(reducer,
  composeEnhancers(
    applyMiddleware(...middleware)
  )
)

// a middleware to run last in the chain, to notify us of actions
const expandedAction = new Rx.Subject
const expandedActionMiddleware = (/* store */) => next => action => {
    expandedAction.next(action)
    return next(action)
}
const expandedAction$ = expandedAction.asObservable()

// Returns a promise for the store which it makes from the promised initialValue
const constructStore = (action, { Collections, Reducers, Epics, dispatchMethod }) => {
    let [ entity ] = action.type.split('.')
    let { collection } = action.meta.store

    return getInitialValue(action, Collections)
        .then(initialValue => {

            let rootEpic = combineEpics(...Object.values(Epics))
            let epicMiddleware = createEpicMiddleware(rootEpic)

            let entityReducer = createReducer(Reducers[entity] || {}, initialValue)
            let store = makeStoreFromReducer(entityReducer, epicMiddleware, expandedActionMiddleware)

            Object.assign(store, {
                updateDB: (diff) => {
                    let id = initialValue.get('_id')
                    console.log(`DB> Updating ${collection}:${id} with`, diff)

                    return Collections[collection].update(id, diff)
                },
                state$: storeToObservable(store),
                expandedAction$
            })
            if (Meteor.isClient) {
                store.hasChanged = new Tracker.Dependency()
                store.expandedAction$.subscribe(dispatchMethod)
                store.expandedAction$.subscribe(() => store.hasChanged.changed())
            }
            return store
        })
}

// Returns a promise for the store whether cached or constructed+cached
export const getStore = (action, { Collections, Reducers, Epics, dispatchMethod }) => {
    let { collection, id } = action.meta.store
    if (!id) {
        id = Collections[collection].findOne()._id
    }
    let storeId = Symbol.for(`${collection}:${id}`)
    let cached = allStores.get(storeId)

    console.log(`DS> Getting ${cached ? '(cached)' : ''} store for ${collection}:${id}`)

    if (cached) {
        return Promise.resolve(cached)
    }

    return constructStore(action, { Collections, Reducers, Epics, dispatchMethod })
        .then(store => {
            allStores.set(storeId, store)
            activeStore.set(store)
            return store
        })
}
