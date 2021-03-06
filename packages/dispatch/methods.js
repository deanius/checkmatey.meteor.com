import { UniMethod } from 'meteor/deanius:uni-method'
import { _ } from 'meteor/underscore'
import { getStore, activeStore } from './store'
import { diff } from 'mongodb-diff'

export const getDispatch = ({ Actions, PayloadSchema, Epics, Reducers, Collections }) => {
    let dispatchMethod = UniMethod.define('deanius:dispatch', {
        mayBeLocallyFulfilled: true,

        validate: () => {
            // TODO Validate the PayloadSchema based on actionType
        },

        clientMethod: (action) => {
            let staysLocal = (action.meta && action.meta.mayBeFulfilledLocally)
            console.log(`DM> (${staysLocal ? 'drop' : 'send'})`, action)
            return staysLocal
        },

        serverMethod: (action) => {
            console.log('DM> ', action);

            if (action.meta && action.meta.store) {
                let promisedStore = getStore(action, { Collections, Reducers, Epics })

                // this little trick here uses Fibers to access the promise result 'synchronously'
                let store = Promise.await(promisedStore)

                let oldState = store.getState()
                store.dispatch(action)
                let newState = store.getState()

                let diffObj = diff(oldState.toJS(), newState.toJS())
                if (! _.isEmpty(diffObj) ) {
                    store.updateDB(diffObj)
                }
            }
            console.log('DM> *')
        }
    })

    // a wrapper function that gets or makes the store
    // with a subscription of most events to dispatchMethod
    return {
        dispatch: (action) => {
            let promisedStore = getStore(action, { Collections, Reducers, Epics, dispatchMethod })

            // returning a truthy value keeps it from going to the server
            // NOTE: important that the return value from store.dispatch is a value, or resolved
            return promisedStore.then(store => store.dispatch(action))
        },
        activeStore
    }
}
