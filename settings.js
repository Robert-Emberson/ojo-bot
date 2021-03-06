var express 		= require('express'),
	util			= require('util'),
	partials 		= require('express-partials'),
	session4 		= require('express-session'),
	cookieParser 	= require('cookie-parser'),
	favicon			= require('serve-favicon'),
	assert			= require('assert'),
	fs				= require('fs'),
	path			= require('path'),
	debug 			= require('debug')('server'),
	engines			= require('consolidate'),
	pg 				= require('pg'),
	pgSession 		= require('connect-pg-simple')(session4),
	ejs				= require('ejs'),
	crypto 			= require('crypto'),
	eyes			= require('eyes'),
	aws				= require("aws-sdk"),
	winston 		= require('winston'),
	facebook		= require('./lib/facebook'),
	GitHubApi 		= require("github"),
	i18n			= require('./lib/i18n-abide'),
	filesize 		= require('filesize'),
	_				= require('underscore'),
	compress		= require('compression'),
	bodyParser 		= require('body-parser'),
	errorHandler 	= require('errorhandler'),
	methodOverride 	= require('method-override'),
	multer 			= require('multer'),
	moment			= require('moment'),
	MemJS			= require('memjs').Client,
	shortid			= require('shortid');

  	require('winston-papertrail').Papertrail;

	global.logger = new winston.Logger({
		transports: [
			new (winston.transports.Console)({
				level: 'info'
			}),

			new winston.transports.Papertrail({
				host: 'logs.papertrailapp.com',
				port: 12836,
				colorize: true,
				level: 'info'
			})
		]
	});
	
	// shortid for database key management
	shortid.seed(20130311);
	app.shortid = shortid;

	//
	// Check if we use AWS S3 for persistence and make sure we can or not
	//
	function CheckAWS_S3() {
		if( app.config.using_aws_s3_for_storage) {
			logger.info("using_aws_s3_for_storage...")
		
			// AWS Amazon
			app.s3_config = {
				accessKeyId: 		process.env.AWS_ACCESSKEYID, 
				secretAccessKey: 	process.env.AWS_SECRETACCESSKEY,
				region:				process.env.AWS_REGION || 'us-east-1',
				cache_dir: 			app.get('tmp_dir')
			}
	
			//console.log("AWS config", app.s3_config)
	
			assert( app.s3_config.accessKeyId, "Missing S3 accessKeyID env" )
			assert( app.s3_config.secretAccessKey, "Missing S3 secretAccessKey env")
			assert( app.s3_config.region, "Missing S3 region env" )
	
			aws.config.update(app.s3_config);

			app.s3 = new aws.S3();

			logger.info("Connected to AWS S3 for data...")
		} else {
			// check if DATA_DIR is set
			var data_dir = process.env.DATA_DIR
			assert( data_dir, "Data Directory is not set")
			if( !fs.existsSync(data_dir) ) {
				throw "Data Directory does not exists"
			} else {
				var tmp_dir = app.get('tmp_dir')
				logger.info("tmp_dir:", tmp_dir)
				logger.info("data_dir:", data_dir)
			}
		}
	}
	
	function Check_Firebase() {
		assert(process.env.FIREBASE_APIKEY)
		assert(process.env.FIREBASE_AUTHDOMAIN)
		assert(process.env.FIREBASE_DATABASURL)
		assert(process.env.FIREBASE_STORAGEBUCKET)
		assert(process.env.FIREBASE_MESSAGESENDERID)
	}
	
//	function Check_AWS_Cognito() {
//		logger.info("using_aws_cognito for identity...")
		
//		app.cognito 						= new aws.CognitoIdentity();
//		app.cognitoidentityserviceprovider 	= new aws.CognitoIdentityServiceProvider();

//		var PoolRegion	= process.env.AWS_REGION 
//		var UserPoolId	= process.env.AWS_USERPOOLID
//		var ClientId	= process.env.AWS_USERCLIENTID
//		var PoolGUID	= process.env.AWS_USERPOOLGUID
		
//		var PoolIdp		= "cognito-idp." + PoolRegion +".amazonaws.com/"+ UserPoolId
				
//		try {
//			if (app.cognito) {

//				var params = {
//				  IdentityPoolId: PoolGUID
//				};
			
//				app.cognito.describeIdentityPool(params, function(err, data) {
//				  if (err) console.log(err, err.stack); // an error occurred
//				  else {
					  // console.log(data);           // successful response

//					  app.cognito.UserPoolId 				= UserPoolId
//					  app.cognito.ClientId 					= ClientId
//					  app.cognito.UserPoolIdp				= PoolIdp
					  
//					  app.cognito.IdentityPoolId 			= data.IdentityPoolId
//					  app.cognito.IdentityPoolName 			= data.IdentityPoolName
//					  app.cognito.SupportedLoginProviders	= data.SupportedLoginProviders
//					}
//				});
//			}
//		} catch(e) {
//			app.cognito = undefined
//			console.log("Cognito exception", e)
//		}
//	}
	
	//
	// Check if we can use AWS SImpel Email Service
	//
	function Check_AWS_SES() {
		if( !process.env.AWS_SMTP_SENDER ) return
			
		// Setting the mail sender
		app.ses = new aws.SES();
		
		// verified SES sender
		app.ses.from = process.env.AWS_SMTP_SENDER
		var params = {
			Destination: {
				ToAddresses:[app.ses.from]
			},
			Message: {
				Body: {
					Html: {
						Data: "OJO-Bot restarted at " + moment().format()
					},
					Text: { 
						Data: "OJO-Bot restart at " + moment().format()
					}
				},
				Subject: {
					Data: "OJO-bot restarted"
				}
			},
			Source: app.ses.from,
			ReplyToAddresses: [ app.ses.from ]
		}		

		// Make sure it works
		
		//app.ses.sendEmail(params, function(err, data) {
		//	if (err) console.log(err, err.stack); // an error occurred
		//	  else console.log(data);           // successful response
		//})
	}
	

	// Create cache
	app.memjs = MemJS.create(null,{
		retries: 10
	});
	
	//var key  = "flood_14km.20161002_4_3_8"
  	//app.memjs.get(key, function(err, val) {
  	//	console.log("cached", key, err, val.toString())
  	//})
	
	// Pick a secret to secure your session storage
	app.sessionSecret = process.env.COOKIEHASH || 'OJO-BOT-PGC-2014-04';
	
	exports.boot = function(app){

		// The port that this express app will listen on
		debug("app_port:"+app_port)
		
		// load config
		app.config 			= JSON.parse(fs.readFileSync("./config/config.yaml"));
		
		process.env.CONTACT_EMAIL	= app.config.contact_mail

		// overload regions for GPM App
		//
		var global_region		= app.config.regions.Global
		var regions				= JSON.parse(fs.readFileSync("imerg_regions.yaml"))
		regions.regions.Global	= global_region
		app.config.regions		= regions.regions
		
		// console.log(app.config.regions)
		
		bootApplication(app)
		
		var social_envs = [
			'FACEBOOK_APP_SECRET',
			'FACEBOOK_APP_ID',
			'FACEBOOK_PROFILE_ID',
			'TWITTER_SITE',
			'TWITTER_SITE_ID',
			'TWITTER_CREATOR',
			'TWITTER_CREATOR_ID',
			'TWITTER_DOMAIN',
			'MAPBOX_PUBLIC_TOKEN'
		]
		
		app.social_envs = {}
		
		_.each(social_envs, function(e) {
			var env_var = process.env[e]
			assert(env_var, "Missing env:"+e)
			app.social_envs[e] = env_var
			//console.log(e, env_var)
		})
		
		var appId				= process.env.FACEBOOK_APP_ID
		var appSecret			= process.env.FACEBOOK_APP_SECRET
		var mapboxToken			= process.env.MAPBOX_PUBLIC_TOKEN
				
		app.config.fbAppId		= appId
		app.config.fbSecret		= appSecret
		app.config.mapboxToken	= mapboxToken
		
		app.facebook			= facebook.init(appId, appSecret)

		app.facebook.GenerateSecret(function(err, secret) {
			//console.log("hawk key:", err,secret)
			if( !err ) {
				app.hawk_secret = secret
				app.hawk_id 	= appId
			} else {
				logger.error("app.facebook.GenerateSecret", err)
				app.hawk_secret = appSecret
				app.hawk_id 	= appId				
			}
		})
		
		CheckAWS_S3()
		Check_AWS_SES()
		Check_Firebase()
	}
	
// ===============================	
// Helper to set env in app global
//
function app_set_env( env_var ) {
	app[env_var] = process.env[env_var]
	assert( app[env_var], env_var + " env is missing")
}
	
// ===========================
// App settings and middleware
function bootApplication(app) {
	// define a custom res.message() method
	// which stores messages in the session
	app.response.message = function(msg){
	  // reference `req.session` via the `this.req` reference
	  var sess = this.req.session;
	  // simply add the msg to an array for later
	  sess.messages = sess.messages || [];
	  sess.messages.push(msg);
	  return this;
	};
	
	app.use(compress());  
	
	// serve static files
	app.use(express.static(__dirname + '/public'));
	app.use(partials());

	app.set('views', __dirname + '/app/views')
	app.set('helpers', __dirname + '/app/helpers/')
   	app.set('view engine', 'ejs');
	app.engine('html', engines.ejs);
	
	app.set('view options', { layout: 'layout.ejs' })

	// cookieParser should be above session
	app.use(cookieParser(process.env.COOKIEHASH))
	
	app.use(methodOverride())

	var conString 	= process.env.DATABASE_URL || "tcp://nodepg:password@localhost:5432/dk";
	logger.info("Connecting to db:", conString)
		
	app.use(session4({
		secret: app.sessionSecret,
		cookie: { maxAge: 1 * 360000}, //1 Hour*24 in milliseconds
		store: new pgSession({
			  pg : pg,
			  conString : conString,
			  tableName : 'session'
		}),
		resave: 	true,
		saveUninitialized: true
	}))

	pg.defaults.ssl = true;

	app.client = new pg.Client(conString);
	app.client.connect(function(err) {
	  if(err) {
	    return logger.error('could not connect to postgres', err);
	  }
	  app.client.query('SELECT NOW() AS "theTime"', function(err, result) {
	    if(err) {
	      	logger.error('error running query', err);
	    } else {
	    	logger.info("startup time: " + result.rows[0].theTime);
		}
	  });
	});

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({ extended: true }));
	app.use(favicon(__dirname + '/public/favicon.png'));	
	
	app.use(bodyParser.text());
		
	//app.use(express.csrf());
	//app.use(function(req, res, next) {
		//res.locals.token = req.csrfToken();
		//console.log('csrf:', res.locals.token);
	//	next()
		//});
	
	app.use(i18n.abide({
		supported_languages: ['en', 'es', 'fr', 'pt', 'sw','ne'],
		//supported_languages: ['en', 'fr', 'es', 'pt', 'de'],
		default_lang: 'en',
		translation_directory: 'locale',
		translation_type: 'transiflex',
		logger: console
	}));

	// localize GetFileSize
	app.locals.GetFileSize = function(fileName, t) {
		try {
			var stats	= fs.statSync( fileName )
			return filesize( stats.size, 
								{round:2, suffixes: {
											"B": t("filesize.B"), 
											"kB": t("filesize.KB"), 
											"MB": t("filesize.MB"), 
											"GB": t("filesize.GB"), 
											"TB": t("filesize.TB")
										}
								}
							)
		} catch( e ) {
			return "NA"
		}
	}
	
	app.locals.filesize = function(size, req ) {
		return filesize( size, {round:2, suffixes: {
										"B": req.gettext("filesize.B"), 
										"kB": req.gettext("filesize.KB"), 
										"MB": req.gettext("filesize.MB"), 
										"GB": req.gettext("filesize.GB"), 
										"TB": req.gettext("filesize.TB")}})
									}
	
	//if ('development' == app.get('env')) {
	//  app.use(errorHandler());
	//}
	
	// expose the "messages" local variable when views are rendered
	//app.use(function(req, res, next){

	//  var msgs = req.session.messages || [];

	  // expose "messages" local variable
	//  res.locals.messages = msgs;

	  // expose "hasMessages"
	//  res.locals.hasMessages = !! msgs.length;

	  /* This is equivalent:
	   res.locals({
	     messages: msgs,
	     hasMessages: !! msgs.length
	   });
	  */

	  // empty or "flush" the messages so they
	  // don't build up
	//  req.session.messages = [];
	//  next();
	//});
	
	//app.use(app.router)
	
	// Error Handling
	//app.use(function(err, req, res, next){
	  // treat as 404
	//  if (~err.message.indexOf('not found')) return next()

	  // log it
	//  console.error(err.stack)

	  // error page
	//  res.status(500).render('500', { layout: false })
	//})

	// assume 404 since no middleware responded
	//app.use(function(req, res, next){
	//  res.status(404).render('404', { layout: false, url: req.originalUrl })
	//})
}
