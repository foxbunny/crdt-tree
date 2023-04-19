class MultiMap {
  constructor(values, options = {}) {
    this.map = new Map(values)
    this.options = options
  }

  get(key) {
    let items = this.map.get(key)
    return items || []
  }

  set(key, value) {
    let items = this.get(key)
    items.push(value)
    if (this.options.sort) items.sort(this.options.sort)
    this.map.set(key, items)
  }

  pop(key, value) {
    let items = this.get(key), returnValue = value
    if (arguments.length === 1) {
      returnValue = items.slice()
      items.length = 0
    }
    else items.splice(items.indexOf(value), 1)
    if (!items.length) this.delete(key)
    return returnValue
  }

  delete(key) {
    this.map.delete(key)
  }

  [Symbol.iterator]() {
    return this.map[Symbol.iterator]()
  }
}

function createTree(nodeList, {
  getTime = Date.now,
  operations = [],
  queue = new MultiMap(),
} = {}) {
  let
    childListLookup = new MultiMap([], {
      sort: function (a, b) {
        if (a.vPos === b.vPos) return a.t - b.t
        return a.vPos - b.vPos
      },
    }),
    root = {
      id: '',
      t: 0,
      get childList() {
        return childListLookup.get('')
      },
    },
    idLookup = new Map([['', root]]),
    parentIdLookup = new Map([['', '']])

  for (let node of nodeList) {
    idLookup.set(node.id, node)
    parentIdLookup.set(node.id, node.parentId)
    childListLookup.set(node.parentId, node)
    Object.defineProperty(node, 'childList', {
      get() {return childListLookup.get(node.id)},
      enumerable: false,
    })
  }

  return {
    idLookup,
    parentIdLookup,
    childListLookup,
    operations,
    queue,
    getTime,
  }
}

// Precondition check

class UnmetPreconditionError extends Error {}

function must(condition, message) {
  if (!condition) throw new UnmetPreconditionError(message)
}

function mustNot(condition, message) {
  if (condition) throw new UnmetPreconditionError(message)
}

// Query the tree

function getValue(tree, nodeId, key) {
  let node = getNode(tree, nodeId)
  return node?.data[key]?.value
}

function getNode(tree, nodeId) {
  return tree.idLookup.get(nodeId)
}

function getNodes(tree) {
  return Array.from(tree.idLookup.values())
}

function getData(tree, nodeId) {
  let node = getNode(tree, nodeId)
  if (node == null) return
  let data = {}
  for (let k in node.data) data[k] = node.data[k].value
  return data
}

function hasNode(tree, nodeId) {
  return tree.idLookup.has(nodeId)
}

function isChild(tree, nodeId, parentId) {
  return tree.parentIdLookup.get(nodeId) === parentId
}

function isSamePosition(tree, parentId, refId, nodeId) {
  if (refId === '') return false
  let {childList} = getNode(tree, parentId)
  for (let i = 0; i < childList.length - 1; i++) {
    let a = childList[i], b = childList[i + 1]
    if (a.id === refId && b.id === nodeId) return true
  }
  return false
}

// Alter the tree

function addNode(tree, node, parentId) {
  tree.idLookup.set(node.id, node)
  setParent(tree, node, parentId)
  if ('childList' in node) return
  Object.defineProperty(node, 'childList', {
    get() {return tree.childListLookup.get(node.id)},
    enumerable: false,
  })
}

function removeNode(tree, node) {
  tree.idLookup.delete(node.id)
  tree.parentIdLookup.delete(node.id)
  tree.childListLookup.pop(node.parentId, node)
}

function setParent(tree, node, parentId) {
  tree.parentIdLookup.set(node.id, parentId)
  tree.childListLookup.set(parentId, node)
  node.parentId = parentId
}

function unsetParent(tree, node) {
  tree.parentIdLookup.delete(node.id)
  tree.childListLookup.pop(node.parentId, node)
  node.parentId = null
}

// Operations

function addOperation(tree, name, t, details) {
  tree.operations.push([name, t, details])
}

function queueOperation(name, tree, t, details) {
  tree.queue.set(details.nodeId, [name, t, details])
}

function setValue(tree, nodeId, key, value) {
  must(hasNode(tree, nodeId), `Must have ${nodeId}`)
  let node = getNode(tree, nodeId)
  node.data[key] = Object.assign(node.data[key] || {}, {value, t: tree.getTime()})
  addOperation(tree, 'setValue', node.data[key].t, {nodeId, key, value})
}

function mergeSetValue(tree, t, {nodeId, key, value}) {
  let node = getNode(tree, nodeId)
  if (node == null) return queueOperation('setValue', ...arguments)
  let tValue = node.data[key]
  if (!tValue) node.data[key] = {value, t}
  else if (tValue.t < t) Object.assign(tValue, {value, t})
}

function _insert(tree, parentId, refId, node) {
  must(hasNode(tree, parentId), `Must have "${parentId}"`)
  must(isChild(tree, refId, parentId) || refId === '', `Must have "${refId}" as child of "${parentId}"`)
  let
    {childList} = getNode(tree, parentId),
    targetIndex = childList.findIndex(function (node) {return node.id === refId}) + 1,
    prevPos = childList[targetIndex - 1]?.vPos || 0,
    nextPos = childList[targetIndex]?.vPos || 1,
    cleanPos = prevPos + 0.4 * (nextPos - prevPos)
  node.vPos = cleanPos + (Math.random() * 0.01 * -0.005)
  node.t = tree.getTime()
  addNode(tree, node, parentId)
}

function insert(tree, parentId, refId, node) {
  must(!hasNode(tree, node.id), `Must not use duplicate id "${node.id}"`)
  _insert(tree, parentId, refId, node)
  addOperation(tree, 'insert', node.t, {parentId, node: {...node}})
}

function mergeInsert(tree, {parentId, node}) {
  if (hasNode(tree, node.id)) return
  addNode(tree, node, parentId)
  merge(tree, tree.queue.pop(node.id) || [])
}

function move(tree, nodeId, parentId, refId) {
  must(hasNode(tree, nodeId), `Must have node "${nodeId}"`)
  must(isChild(tree, refId, parentId) || refId === '', `Must have node "${refId}" as child of "${parentId}"`)
  mustNot(isSamePosition(tree, parentId, refId, nodeId), `Must not move into itself`)
  let
    node = getNode(tree, nodeId),
    currentParentId = tree.parentIdLookup.get(nodeId)
  unsetParent(tree, node, currentParentId)
  _insert(tree, parentId, refId, node)
  if (node.removed != null) delete node.removed
  addOperation(tree, 'move', node.t, {nodeId: node.id, parentId, vPos: node.vPos})
}

function mergeMove(tree, t, {nodeId, parentId, vPos}) {
  let node = getNode(tree, nodeId)
  if (!node) return queueOperation('move', ...arguments)
  if (node.t > t) return
  node.vPos = vPos
  node.t = t
  unsetParent(tree, node)
  addNode(tree, node, parentId)
  if (node.removed != null && node.removed < t) delete node.removed
}

function remove(tree, nodeId) {
  must(hasNode(tree, nodeId), `Must not remove a non-existent node ${nodeId}`)
  let node = getNode(tree, nodeId)
  if (node.removed != null) return
  node.removed = tree.getTime()
  addOperation(tree, 'remove', node.removed, {nodeId: node.id})
}

function mergeRemove(tree, t, {nodeId}) {
  let node = getNode(tree, nodeId)
  if (node == null) return queueOperation('remove', ...arguments)
  if (node.t > t) return
  if (node.removed > t) return
  node.removed = t
}

function merge(tree, operations) {
  for (let [name, t, details] of operations) {
    switch (name) {
      case 'setValue':
        mergeSetValue(tree, t, details)
        break
      case 'insert':
        mergeInsert(tree, details)
        break
      case 'move':
        mergeMove(tree, t, details)
        break
      case 'remove':
        mergeRemove(tree, t, details)
        break
      default:
        throw Error(`Invalid acton "${name}"`)
    }
  }
}

function purgeRemovedNodes(tree, minAge = 0) {
  let now = tree.getTime(), purged = []
  for (let node of tree.idLookup.values()) if (now - node.removed >= minAge) {
    removeNode(tree, node)
    purged.push(node.id)
  }
  return purged
}

export {
  UnmetPreconditionError,
  createTree,
  getNode,
  getNodes,
  getData,
  getValue,
  setValue,
  insert,
  move,
  remove,
  merge,
  purgeRemovedNodes,
}
