<?php
require_once("DatabaseObject.php");
require_once("database.php");
require_once("constants.php");
require_once("user.php");
require_once("function.php");
require_once("Session.php");
include_once("header.php");

if(!isset($_SESSION['user_id'])){
	redirect_to('login.php');
}
?>

<div class="container-fluid">
 	<div class="row-fluid">
    	<div class="span2">
			<ul id="settingsNavigator" class="nav nav-list navMenu">
			 	<li class="nav-header">Navigation</li>
				<li>
					<a href="index.php">Back To Main</a>
				</li>

			 	<li class="nav-header">Settings</li>
				<li>
					<a href="#" id="users">Users</a>
				</li>
				<script>
					$('#users').unbind().click(function(e){
						e.preventDefault();
						e.stopPropagation();

						$('#settingsControls').load('userALE.php');
						//alert('1 1 1');
					});
				</script>
				<li>
					<a href="#" id="userRoleAdd">Roles</a>
				</li>
				<script>
					$('#userRoleAdd').unbind().click(function(e){
						e.preventDefault();
						e.stopPropagation();

						$('#settingsControls').load('userRoleALE.php');
						//alert('2');
					});
				</script>
				<li>
					<a href="uploadCategory.php" id="categoryAdd">Speech Categories</a>
				</li>
				<script>
					$('#categoryAdd').unbind().click(function(e){
						e.preventDefault();
						e.stopPropagation();

						$('#settingsControls').load('categoryALE.php');
						//alert('3');
					});
				</script>
				<li>
					<a href="uploadTopic.php" id="topicAdd">Topics</a>
				</li>
				<script>
					$('#topicAdd').unbind().click(function(e){
						e.preventDefault();
						e.stopPropagation();

						$('#settingsControls').load('topicALE.php');
						//alert('forTopic');
					});
				</script>
				<li>
					<a href="noteListing.php" id="noteListing">Note Listing</a>
				</li>
				<script>
					$('#noteListing').unbind().click(function(e){
						e.preventDefault();
						e.stopPropagation();

						$('#settingsControls').load('noteALE.php');
						//alert('4');
					});
				</script>


			</ul>
    	</div>
    	<div id="settingsControls">

	    </div>
  	</div>
</div>



<?php
include_once("footer.php");
?>

