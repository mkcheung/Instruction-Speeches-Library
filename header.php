<!DOCTYPE html>
<html lang="en">
		<head>
			<link href = "../css/bootstrap.css" type="text/css" rel="stylesheet">
			<link href = "../css/bootstrap-responsive.min.css" type="text/css" rel="stylesheet">
			<link href = "../css/customized.css" type="text/css" rel="stylesheet">


			<link href = "styles.css" type="text/css" rel="stylesheet">
<link rel="stylesheet" href="http://code.jquery.com/ui/1.10.0/themes/base/jquery-ui.css">
<script src="http://code.jquery.com/ui/1.10.0/jquery-ui.js"></script>

			<script type="text/javascript" src="../js/jquery-1.9.0.js"></script>
			<script type="text/javascript" src="../js/jquery.form.js"></script>
			<script type="text/javascript" src="../js/jquery-ui-1.10.0.custom.js"></script>
			<script type="text/javascript" src="../js/bootstrap.js"></script>
			
			<script type ="text/javascript" src="submit.js"></script>

		</head>

		<body style="padding-top:60px;">
			<div class="navbar navbar-inverse navbar-fixed-top" >
			  <div class="navbar-inner">
			  	<div class="container-fluid">
				    <a class="brand" href="#">Toastmasters Of The Cove</a>
				    <ul class="nav">
				      <li class="active"><a href="index.php">Home</a></li>
				      <li><a href="settings.php">Settings</a></li>
				      <li><a href="#"></a></li>
				    </ul>
				    <?php if(!isset($_SESSION['user_id'])) {?>
				    	<a class="btn btn-primary pull-right" href="register.php">Register</a>
				    	

				    	<form class="navbar-form pull-right" action="login.php" method="post" id="LoginForm">
				    		<input class="span2" type="text" id="username" name="username"/>
				    		<input class="span2" type="password" id="password" name="password"/>
				    		<input type="submit" name="Login" id="loginSubmit" class="btn btn-primary"/>
				    	</form>
				    


				    <?php } else { ?>
				    	<a class="btn btn-primary pull-right" href="logout.php">Logout</a>
				    <?php } ?>
  				</div>
			  </div>
			</div>