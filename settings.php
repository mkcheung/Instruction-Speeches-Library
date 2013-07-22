<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("function.php");
require_once("Session.php");
include_once("header.php");

if(!isset($SESS->userId)){
	redirect_to('login.php');
}


if($SESS->userRoleId != ADMIN_USER){
	$SESS->logout();
	redirect_to("login.php", 1, "Access Denied.");
}

?>

<div class="container-fluid">
 	<div class="row-fluid">
    	<div class="span2">
			<ul id="settingsNavigator" class="nav nav-list navMenu well">
			 	<li class="nav-header">
			 		Toastmasters Library
			 	</li>
				<li>
					<a href="logout.php">Logout</a>
				</li>
				<li>
					<a href="index.php">Back To Main</a>
				</li>
			</ul>
    	</div>
    	<div class="span10">
	    	<div id="settingsControls">
	    		<ul class="nav nav-tabs" id="myTab">
				  <li class="active"><a href="#users">Users</a></li>
				  <li><a href="#roles">Roles</a></li>
				  <li><a href="#manuals">Manuals</a></li>
				  <li><a href="#speechCategories">Categories</a></li>
				  <li><a href="#topics">Topics</a></li>
				  <li><a href="#clubs">Clubs</a></li>
				</ul>
				<div class="tab-content">
				  <div class="tab-pane active" id="users"><script>$('#users').load('userALE.php');</script></div>
				  <div class="tab-pane" id="roles"><script>$('#roles').load('userRoleALE.php');</script></div>
				  <div class="tab-pane" id="manuals"><script>$('#manuals').load('manualALE.php');</script></div>
				  <div class="tab-pane" id="speechCategories"><script>$('#speechCategories').load('categoryALE.php');</script></div>
				  <div class="tab-pane" id="topics"><script>$('#topics').load('topicALE.php');</script></div>
				  <div class="tab-pane" id="clubs"><script>$('#clubs').load('clubALE.php');</script></div>
				</div>
				 
				<script>
				  $('#myTab a').click(function (e) {
					  e.preventDefault();
					  $(this).tab('show');
					})
				</script>
		    </div>
		</div>
  	</div>
</div>

<?php
include_once("footer.php");
?>

