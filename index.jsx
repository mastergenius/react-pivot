var _ = {
  filter: require('lodash/filter'),
  map: require('lodash/map'),
  find: require('lodash/find')
}
var React = require('react')
var DataFrame = require('dataframe')
// Hack: inline wildemitter
// var Emitter = require('wildemitter')

var partial = require('./lib/partial')
var download = require('./lib/download')
var getValue = require('./lib/get-value')
var PivotTable = require('./lib/pivot-table.jsx')
var Dimensions = require('./lib/dimensions.jsx')
var ColumnControl = require('./lib/column-control.jsx')

// Hack: inline wildemitter
function WildEmitter() { }

WildEmitter.mixin = function (constructor) {
  var prototype = constructor.prototype || constructor;

  prototype.isWildEmitter= true;

  // Listen on the given `event` with `fn`. Store a group name if present.
  prototype.on = function (event, groupName, fn) {
    this.callbacks = this.callbacks || {};
    var hasGroup = (arguments.length === 3),
        group = hasGroup ? arguments[1] : undefined,
        func = hasGroup ? arguments[2] : arguments[1];
    func._groupName = group;
    (this.callbacks[event] = this.callbacks[event] || []).push(func);
    return this;
  };

  // Adds an `event` listener that will be invoked a single
  // time then automatically removed.
  prototype.once = function (event, groupName, fn) {
    var self = this,
        hasGroup = (arguments.length === 3),
        group = hasGroup ? arguments[1] : undefined,
        func = hasGroup ? arguments[2] : arguments[1];
    function on() {
      self.off(event, on);
      func.apply(this, arguments);
    }
    this.on(event, group, on);
    return this;
  };

  // Unbinds an entire group
  prototype.releaseGroup = function (groupName) {
    this.callbacks = this.callbacks || {};
    var item, i, len, handlers;
    for (item in this.callbacks) {
      handlers = this.callbacks[item];
      for (i = 0, len = handlers.length; i < len; i++) {
        if (handlers[i]._groupName === groupName) {
          //console.log('removing');
          // remove it and shorten the array we're looping through
          handlers.splice(i, 1);
          i--;
          len--;
        }
      }
    }
    return this;
  };

  // Remove the given callback for `event` or all
  // registered callbacks.
  prototype.off = function (event, fn) {
    this.callbacks = this.callbacks || {};
    var callbacks = this.callbacks[event],
        i;

    if (!callbacks) return this;

    // remove all handlers
    if (arguments.length === 1) {
      delete this.callbacks[event];
      return this;
    }

    // remove specific handler
    i = callbacks.indexOf(fn);
    callbacks.splice(i, 1);
    if (callbacks.length === 0) {
      delete this.callbacks[event];
    }
    return this;
  };

  /// Emit `event` with the given args.
  // also calls any `*` handlers
  prototype.emit = function (event) {
    this.callbacks = this.callbacks || {};
    var args = [].slice.call(arguments, 1),
        callbacks = this.callbacks[event],
        specialCallbacks = this.getWildcardCallbacks(event),
        i,
        len,
        item,
        listeners;

    if (callbacks) {
      listeners = callbacks.slice();
      for (i = 0, len = listeners.length; i < len; ++i) {
        if (!listeners[i]) {
          break;
        }
        listeners[i].apply(this, args);
      }
    }

    if (specialCallbacks) {
      len = specialCallbacks.length;
      listeners = specialCallbacks.slice();
      for (i = 0, len = listeners.length; i < len; ++i) {
        if (!listeners[i]) {
          break;
        }
        listeners[i].apply(this, [event].concat(args));
      }
    }

    return this;
  };

  // Helper for for finding special wildcard event handlers that match the event
  prototype.getWildcardCallbacks = function (eventName) {
    this.callbacks = this.callbacks || {};
    var item,
        split,
        result = [];

    for (item in this.callbacks) {
      split = item.split('*');
      if (item === '*' || (split.length === 2 && eventName.slice(0, split[0].length) === split[0])) {
        result = result.concat(this.callbacks[item]);
      }
    }
    return result;
  };

};

WildEmitter.mixin(WildEmitter);

var PivotEmmiter = function () {};
WildEmitter.mixin(PivotEmmiter);


module.exports = React.createClass({
  displayName: 'ReactPivot',
  getDefaultProps: function() {
    return {
      rows: [],
      dimensions: [],
      activeDimensions: [],
      reduce: function() {},
      tableClassName: '',
      csvDownloadFileName: 'table.csv',
      csvTemplateFormat: false,
      defaultStyles: true,
      nPaginateRows: 25,
      solo: null,
      hiddenColumns: [],
      sortBy: null,
      sortDir: 'asc',
      eventBus: new PivotEmmiter(),
      compact: false,
      excludeSummaryFromExport: false,
      onData: function () {}
    }
  },

  getInitialState: function() {
    var allDimensions = this.props.dimensions
    var activeDimensions =  _.filter(this.props.activeDimensions, function (title) {
      return _.find(allDimensions, function(col) {
        return col.title === title
      })
    })

    return {
      dimensions: activeDimensions,
      calculations: {},
      sortBy: this.props.sortBy,
      sortDir: this.props.sortDir,
      hiddenColumns: this.props.hiddenColumns,
      solo: this.props.solo,
      rows: []
    }
  },

  componentWillMount: function() {
    if (this.props.defaultStyles) loadStyles()

    this.dataFrame = DataFrame({
      rows: this.props.rows,
      dimensions: this.props.dimensions,
      reduce: this.props.reduce
    })

    this.updateRows()
  },

  componentWillReceiveProps: function(newProps) {
    if(newProps.rows !== this.props.rows) {
      this.dataFrame = DataFrame({
        rows: newProps.rows,
        dimensions: this.props.dimensions,
        reduce: this.props.reduce
      })

      this.updateRows()
    }
  },

  getColumns: function() {
    var self = this
    var columns = []

    this.state.dimensions.forEach(function(title) {
      var d =  _.find(self.props.dimensions, function(col) {
        return col.title === title
      })

      columns.push({
        type: 'dimension', title: d.title, value: d.value,
        className: d.className, template: d.template
      })
    })

    this.props.calculations.forEach(function(c) {
      if (self.state.hiddenColumns.indexOf(c.title) >= 0) return

      columns.push({
        type:'calculation', title: c.title, template: c.template,
        value: c.value, className: c.className
      })
    })

    return columns
  },

  render: function() {
    var html = (
        <div className='reactPivot'>

          { this.props.hideDimensionFilter ? '' :
              <Dimensions
                  dimensions={this.props.dimensions}
                  selectedDimensions={this.state.dimensions}
                  onChange={this.setDimensions} />
          }

          <ColumnControl
              hiddenColumns={this.state.hiddenColumns}
              onChange={this.setHiddenColumns} />

          <div className="reactPivot-csvExport">
            <button onClick={partial(this.downloadCSV, this.state.rows)}>
              Export CSV
            </button>
          </div>

          { !this.state.solo ? '' :
              <div style={{clear: 'both'}} className='reactPivot-soloDisplay'>
            <span className='reactPivot-clearSolo' onClick={this.clearSolo}>
              &times;
            </span>
                {this.state.solo.title}: {this.state.solo.value}
              </div>
          }

          <PivotTable
              columns={this.getColumns()}
              rows={this.state.rows}
              sortBy={this.state.sortBy}
              sortDir={this.state.sortDir}
              onSort={this.setSort}
              onColumnHide={this.hideColumn}
              nPaginateRows={this.props.nPaginateRows}
              onSolo={this.setSolo} />

        </div>
    )

    return html
  },

  updateRows: function () {
    var columns = this.getColumns()

    var sortByTitle = this.state.sortBy
    var sortCol = _.find(columns, function(col) {
          return col.title === sortByTitle
        }) || {}
    var sortBy = sortCol.type === 'dimension' ? sortCol.title : sortCol.value
    var sortDir = this.state.sortDir

    var calcOpts = {
      dimensions: this.state.dimensions,
      sortBy: sortBy,
      sortDir: sortDir,
      compact: this.props.compact
    }

    var filter = this.state.solo
    if (filter) {
      calcOpts.filter = function(dVals) {
        return dVals[filter.title] === filter.value
      }
    }

    var rows = this.dataFrame.calculate(calcOpts)
    this.setState({rows: rows})
    this.props.onData(rows)
  },

  setDimensions: function (updatedDimensions) {
    this.props.eventBus.emit('activeDimensions', updatedDimensions)
    this.setState({dimensions: updatedDimensions})
    setTimeout(this.updateRows, 0)
  },

  setHiddenColumns: function (hidden) {
    this.props.eventBus.emit('hiddenColumns', hidden)
    this.setState({hiddenColumns: hidden})
    setTimeout(this.updateRows, 0)
  },

  setSort: function(cTitle) {
    var sortBy = this.state.sortBy
    var sortDir = this.state.sortDir
    if (sortBy === cTitle) {
      sortDir = (sortDir === 'asc') ? 'desc' : 'asc'
    } else {
      sortBy = cTitle
      sortDir = 'asc'
    }

    this.props.eventBus.emit('sortBy', sortBy)
    this.props.eventBus.emit('sortDir', sortDir)
    this.setState({sortBy: sortBy, sortDir: sortDir})
    setTimeout(this.updateRows, 0)
  },

  setSolo: function(solo) {
    this.props.eventBus.emit('solo', solo)
    this.setState({solo: solo })
    setTimeout(this.updateRows, 0)
  },

  clearSolo: function() {
    this.props.eventBus.emit('solo', null)
    this.setState({solo: null})
    setTimeout(this.updateRows, 0)
  },

  hideColumn: function(cTitle) {
    var hidden = this.state.hiddenColumns
    hidden.push(cTitle)
    this.setHiddenColumns(hidden)
    setTimeout(this.updateRows, 0)
  },

  downloadCSV: function(rows) {
    var self = this

    var columns = this.getColumns()

    var csv = _.map(columns, 'title')
            .map(JSON.stringify.bind(JSON))
            .join(',') + '\n'

    var maxLevel = this.state.dimensions.length - 1
    var excludeSummary = this.props.excludeSummaryFromExport

    rows.forEach(function(row) {
      if (excludeSummary && (row._level < maxLevel)) return

      var vals = columns.map(function(col) {

        if (col.type === 'dimension') {
          var val = row[col.title]
        } else {
          var val = getValue(col, row)
        }

        if (col.template && self.props.csvTemplateFormat) {
          val = col.template(val)
        }

        return JSON.stringify(val)
      })
      csv += vals.join(',') + '\n'
    })

    download(csv, this.props.csvDownloadFileName, 'text/csv')
  }
})

function loadStyles () { require('./style.css') }
